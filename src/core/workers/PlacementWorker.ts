import { Node } from "../Node.js";
import { Placement } from "../Placement.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
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
      if (!Placement.sourcePlacements[target]) {
        Placement.sourcePlacements[target] = [];
      }
      if (!Placement.sourcePlacements[target].includes(node)) {
        Placement.sourcePlacements[target].push(node);
      }

      // If we don't have an activePlacement but a target exists in the array, assign it directly
      if (!activePlacement) {
        const targetNode = Placement.placementArray.find(n => n.placement?.placementName === target);
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
      const targetNode = Placement.placementArray.find(n => n.placement?.placementName === activePlacement);
      if (targetNode && targetNode.placement) {
        targetNode.placement.placeInto(node);
      }
    } else if (!activePlacement && node.wasPlaced) {
      PlacementWorker.restorePlacement(node);
    }

    // Handle when a node starts providing a placement dynamically
    if (node.placement?.placementName && !Placement.placementArray.includes(node)) {
      node.placement.append();
    }
  }

  public static restorePlacement(node: Node): void {
    if (!node.wasPlaced) return;

    if (node.parent) {
      node.parent.invalidateChildrenCache();
      if (node.parent.placement && node.parent.placement._referencingNodes) {
        node.parent.placement._referencingNodes.delete(node);
      }
    }

    if (node.originalParent && node.originalIndex > -1) {
      node.parent = node.originalParent;
      node.parent.nativeChildren.splice(node.originalIndex, 0, node);
      node.parent.invalidateChildrenCache();
    } else {
      node.parent = null;
    }

    node.originalParent = null;
    node.originalIndex = -1;
    node.wasPlaced = false;
  }

  public static restoreAllPlacements(): void {
    const allPlacedNodes = Object.values(Placement.sourcePlacements).flat();
    for (const node of allPlacedNodes) {
      PlacementWorker.restorePlacement(node);
    }
    Placement.clearPlacements();
  }



  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 1;
    let isAttached = false;
    let current: Node | null | undefined = node;
    
    while (current !== undefined) {
      if (current === null) {
        isAttached = true;
        break;
      }
      current = current.parent;
    }

    if (isAttached) {
      Supervisor.emitToPhase(node, _rollbackState || {}, 2);
    }
  }
}
