import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PlacementWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 1: Placement

    const getTargetPlacements = (nodeRef: Node) => {
      const placementData = nodeRef.placement !== undefined ? nodeRef.placement : nodeRef.data?.placement;
      return placementData?.targetPlacement || [];
    };

    let activePlacement = node.activePlacement;

    // Register node targeting a placement
    const targets = getTargetPlacements(node);
    for (const target of targets) {
      if (!Node.sourcePlacements[target]) {
        Node.sourcePlacements[target] = [];
      }
      if (!Node.sourcePlacements[target].includes(node)) {
        Node.sourcePlacements[target].push(node);
      }

      // If we don't have an activePlacement but a target exists in the array, assign it directly
      if (!activePlacement) {
        const targetNode = Node.placementArray.find(n => n.placement?.placementName === target);
        if (targetNode) {
          activePlacement = target;
          node.activePlacement = target;
          break; // take first available
        }
      }
    }

    // Handle physical tree restructuring based on activePlacement
    const currentPlacementTarget = node.parent?.placement?.placementName;

    if (activePlacement && activePlacement !== currentPlacementTarget) {
      const targetNode = Node.placementArray.find(n => n.placement?.placementName === activePlacement);
      if (targetNode) {
        PlacementWorker.placeInto(node, targetNode);
      }
    } else if (!activePlacement && node.wasPlaced) {
      PlacementWorker.restorePlacement(node);
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
      node.originalParent = node.parent;
      node.originalIndex = node.parent.children.indexOf(node);
      if (node.originalIndex > -1) {
        node.parent.children.splice(node.originalIndex, 1);
      }
    }
    node.parent = target;
    node.wasPlaced = true;
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

      const newPlacement = node.placement.placementName;
      const referencingNodes = Node.sourcePlacements[newPlacement] || [];
      for (const ref of referencingNodes) {
        ref.receiveNextState({ activePlacement: undefined }, 1);
      }
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
