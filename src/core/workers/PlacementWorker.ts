import { Node } from "../Node.js";
import { Placement } from "../Placement.js";
import { BaseWorker } from "./BaseWorker.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

/**
 * Worker handling Phase 1 (Placement) of the Supervisor pipeline.
 *
 * @useCase Matches content nodes requesting specific target drop-zones (`targetPlacement`) to template target placements (`placementName`).
 * @processFlow Second worker stage executed after Phase 0 Instantiation.
 * @queueEmissions Events are emitted to Phase 1 queue when a `Placement` object with `targetPlacement` is created on an in-tree node during construction, when `placement` definitions update via `node.receiveNextState()`, or when `Supervisor.emitToPhase(caller, node, state, 1)` is explicitly called.
 */
export class PlacementWorker extends BaseWorker {
  /** Phase 1 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('placement');

  /**
   * Processes a node during Phase 1 placement matching and reparenting.
   *
   * @param node Node instance to process.
   */
  protected async processNode(node: Node): Promise<void> {
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

  /**
   * Resets and clears all placement mapping registries.
   *
   * @useCase Invoked prior to pipeline re-runs to clear stale placement bindings.
   * @processFlow Pipeline cleanup and initialization.
   */
  public static restoreAllPlacements(): void {
    Placement.clearPlacements();
  }

  /**
   * Updates `node.lastCompletedPhase` to 1 upon success.
   *
   * @param node Successfully processed Node.
   */
  protected onProcessSuccess(node: Node): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('placement');
  }

  /**
   * Log handler for errors during placement phase.
   *
   * @param node Target node that failed.
   * @param error Error thrown during placement.
   */
  protected onProcessError(node: Node, error: Error): void {
    console.error(`Error in Placement Phase for node ${node.css?.id}:`, error);
  }
}
