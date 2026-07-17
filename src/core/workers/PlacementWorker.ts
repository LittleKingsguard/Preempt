import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PlacementWorker extends BaseWorker {
  protected async processNode(node: Node, rollbackState?: RollbackState): Promise<void> {
    // Phase 1: Placement
    const getPlacementName = (placementData: any) => {
      if (typeof placementData === 'string') return placementData;
      return placementData?.placementName;
    };
    
    const getTargetPlacements = (nodeRef: any) => {
      const placementData = nodeRef.placement !== undefined ? nodeRef.placement : nodeRef.data?.placement;
      let targets: string[] = [];
      if (typeof placementData === 'string') targets = [placementData];
      else if (Array.isArray(placementData)) targets = placementData;
      else if (placementData?.targetPlacement) targets = Array.isArray(placementData.targetPlacement) ? placementData.targetPlacement : [placementData.targetPlacement];
      
      const targetPlacementsData = nodeRef.targetPlacements !== undefined ? nodeRef.targetPlacements : nodeRef.data?.targetPlacements;
      if (Array.isArray(targetPlacementsData)) {
        targets = [...targets, ...targetPlacementsData];
      }
      return targets;
    };

    const oldPlacementData = rollbackState?.data?.placement !== undefined ? rollbackState.data.placement : rollbackState?.placement;
    const newPlacementData = node.data?.placement !== undefined ? node.data.placement : node.placement;
    
    const oldPlacement = getPlacementName(oldPlacementData);
    const newPlacement = getPlacementName(newPlacementData);

    // If a placement is removed or changed from what it was
    if (oldPlacement && oldPlacement !== newPlacement) {
      // Remove from global array
      const index = Node.placementArray.indexOf(node);
      if (index > -1) {
        Node.placementArray.splice(index, 1);
      }
      
      // Cascade to referencing nodes
      const referencingNodes = Node.sourcePlacements[oldPlacement] || [];
      for (const ref of referencingNodes) {
         // Find fallback placement for referencing node
         const targets = getTargetPlacements(ref);
         const fallback = targets.find((t: string) => t !== oldPlacement) || null;
         
         // Trigger update
         ref.receiveNextState({ activePlacement: fallback } as unknown as Partial<Node>);
      }
    }

    // If a new placement is added
    if (newPlacement && oldPlacement !== newPlacement) {
      if (!Node.placementArray.includes(node)) {
        Node.placementArray.push(node);
      }
      
      // Cascade to referencing nodes waiting for this placement
      const referencingNodes = Node.sourcePlacements[newPlacement] || [];
      for (const ref of referencingNodes) {
        ref.receiveNextState({ activePlacement: newPlacement } as unknown as Partial<Node>);
      }
    }

    // Handle physical tree restructuring based on activePlacement
    const activePlacement = (node as any).activePlacement;
    
    // If activePlacement changed, we need to restructure
    const currentPlacementTarget = node.parent?.placement?.placementName;

    if (activePlacement && activePlacement !== currentPlacementTarget) {
      const targetNode = Node.placementArray.find(n => n.placement?.placementName === activePlacement);
      if (targetNode) {
        PlacementWorker.placeInto(node, targetNode);
      }
    } else if (!activePlacement && node.wasPlaced) {
      PlacementWorker.restorePlacement(node);
    }

    // Register node targeting a placement
    const targets = getTargetPlacements(node);
    for (const target of targets) {
      if (!Node.sourcePlacements[target]) {
        Node.sourcePlacements[target] = [];
      }
      if (!Node.sourcePlacements[target].includes(node)) {
        Node.sourcePlacements[target].push(node);
      }
      
      // If we don't have an activePlacement but a target exists in the array, push an update
      if (!activePlacement) {
        const targetNode = Node.placementArray.find(n => n.placement?.placementName === target);
        if (targetNode) {
          node.receiveNextState({ activePlacement: target } as unknown as Partial<Node>);
          break; // take first available
        }
      }
    }
  }

  public static placeInto(node: Node, target: Node): void {
    if (target === node) {
      throw new Error("Cannot place node into itself");
    }
    let current: Node | null = target.parent;
    while (current) {
      if (current === node) {
        throw new Error("Cannot place node into a descendant");
      }
      current = current.parent;
    }

    if (node.parent) {
      node.parent.hasChangedSinceRender = true;
      node.originalParent = node.parent;
      node.originalIndex = node.parent.children.indexOf(node);
      if (node.originalIndex > -1) {
        node.parent.children.splice(node.originalIndex, 1);
      }
    }
    node.parent = target;
    node.wasPlaced = true;
    target.hasChangedSinceRender = true;
    target.children.push(node);

    if (target.placement) {
      if (!target.placement._referencingNodes) target.placement._referencingNodes = [];
      if (!target.placement._referencingNodes.includes(node)) {
        target.placement._referencingNodes.push(node);
      }
    }
  }

  public static restorePlacement(node: Node): void {
    if (!node.wasPlaced) return;

    if (node.parent) {
      node.parent.hasChangedSinceRender = true;
      const index = node.parent.children.indexOf(node);
      if (index > -1) {
        node.parent.children.splice(index, 1);
      }
      if (node.parent.placement && node.parent.placement._referencingNodes) {
        const refIndex = node.parent.placement._referencingNodes.indexOf(node);
        if (refIndex > -1) {
          node.parent.placement._referencingNodes.splice(refIndex, 1);
        }
      }
    }

    if (node.originalParent && node.originalIndex > -1) {
      node.parent = node.originalParent;
      node.parent.hasChangedSinceRender = true;
      node.parent.children.splice(node.originalIndex, 0, node);
    } else {
      node.parent = null;
    }

    node.originalParent = null;
    node.originalIndex = -1;
    node.wasPlaced = false;
  }

  public static restoreAllPlacements(): void {
    const allPlacedNodes = Object.values(Node.sourcePlacements).flat();
    for (const node of allPlacedNodes) {
      PlacementWorker.restorePlacement(node);
    }
    Node.clearPlacements();
  }

  public static appendPlacement(node: Node): void {
    if (node.placement?.placementName && !Node.placementArray.includes(node)) {
      Node.placementArray.push(node);
    }
    if (node.placement?.targetPlacement) {
      for (const target of node.placement.targetPlacement) {
        if (!Node.sourcePlacements[target]) {
          Node.sourcePlacements[target] = [];
        }
        if (!Node.sourcePlacements[target].includes(node)) {
          Node.sourcePlacements[target].push(node);
        }
      }
    }
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 2);
    }
  }
}
