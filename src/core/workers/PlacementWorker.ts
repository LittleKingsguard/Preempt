import { Node } from "../Node.js";
import { Placement } from "../Placement.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PlacementWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 1: Placement

    if (!node.placement) return;

    for (const placement of node.placement) {
      // 1. If it provides a placement location dynamically
      if (placement.placementName && !Placement.placementArray.includes(placement)) {
        placement.append();
      }

      // 2. If it targets a placement
      if (placement.targetPlacement) {
        let placed = false;
        
        for (const target of placement.targetPlacement) {
          if (!Placement.sourcePlacements[target]) {
            Placement.sourcePlacements[target] = [];
          }
          if (!Placement.sourcePlacements[target].includes(placement)) {
            Placement.sourcePlacements[target].push(placement);
          }

          if (!placed) {
            const targetPlacement = Placement.placementArray.find(p => p.placementName === target);
            if (targetPlacement) {
              targetPlacement.placeInto(node);
              placed = true;
            }
          }
        }
      }
    }
  }

  public static restoreAllPlacements(): void {
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
      Supervisor.emitToPhase(node, _rollbackState || {}, 2); // emit to Content
    }
  }

  protected onProcessError(node: Node, error: Error, _rollbackState?: RollbackState): void {
    console.error(`Error in Placement Phase for node ${node.css?.id}:`, error);
  }
}
