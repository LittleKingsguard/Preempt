import { Node } from "../Node.js";
import { Placement } from "../Placement.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { PhaseRegistry } from "../PhaseRegistry.js";
import { Supervisor } from "../Supervisor.js";

/**
 * Worker handling Phase 1 (Target Placement Resolution) of the Supervisor pipeline.
 *
 * @useCase Evaluates targetPlacement lists on content/template nodes, matching them against available placementName drop-zones and assigning activePlacement.
 * @processFlow First placement processing stage. Locked on phase completion.
 */
export class TargetPlacementResolverWorker extends BaseWorker {
  public readonly phase = PhaseRegistry.getPhaseNumber('targetPlacementResolution');

  /**
   * Processes target placement matching for a single Node instance.
   *
   * @param node Node instance containing targetPlacement definitions.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[TargetPlacementResolverWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);

    if (!node.placement) return;

    for (const placement of node.placement) {
      if (placement.targetPlacement) {
        for (const target of placement.targetPlacement) {
          const targetPlacements = Placement.placementMap.get(target) || [];
          if (targetPlacements.length > 0) {
            placement.activePlacement = target;
            break;
          }
        }
      }
    }
  }

  /**
   * Updates `node.lastCompletedPhase` and emits to next placement phase.
   *
   * @param node Successfully resolved Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('targetPlacementResolution');
    Supervisor.emitToPhaseName(this, node, _rollbackState || {}, 'placementAssembly');
  }
}
