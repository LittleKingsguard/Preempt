import { Node } from "../Node.js";
import { Placement } from "../Placement.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PlacementWorker extends BaseWorker {
  public readonly phase = 1;

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[PlacementWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 1: Placement

    if (!node.placement) return;

    for (const placement of node.placement) {
      if (placement.targetPlacement) {
        for (const target of placement.targetPlacement) {
          const targetPlacements = Placement.placementMap.get(target) || [];
          if (targetPlacements.length > 0) {
            for (const targetPlacement of targetPlacements) {
              targetPlacement.placeInto(node);
            }
            break;
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
  }

  protected onProcessError(node: Node, error: Error, _rollbackState?: RollbackState): void {
    console.error(`Error in Placement Phase for node ${node.css?.id}:`, error);
  }
}
