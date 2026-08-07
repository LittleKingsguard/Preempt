import { Node } from "../Node.js";
import { NodeLayer } from "../NodeLayer.js";
import { Placement } from "../Placement.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { PhaseRegistry } from "../PhaseRegistry.js";
import { Supervisor } from "../Supervisor.js";

/**
 * Worker handling Phase 2 (Placement Assembly) of the Supervisor pipeline.
 *
 * @useCase Assembles content nodes targeting placement drop-zones into host placement containers.
 * @processFlow Second placement processing stage. Locked at end of assembly phase.
 */
export class PlacementAssemblyWorker extends BaseWorker {
  public readonly phase = PhaseRegistry.getPhaseNumber('placementAssembly');

  /**
   * Processes target placement assembly for the host node.
   *
   * @param node Host Node containing placement definitions.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[PlacementAssemblyWorker] Assembling placements for node: ${node.type} | ID: ${node.props?.id}`);

    if (node.placement && Array.isArray(node.placement)) {
      for (const placement of node.placement) {
        if (placement.placementName) {
          const sourcePlacements = Placement.sourcePlacements.get(placement.placementName) || [];
          const placedChildren: Node[] = [];

          for (const sourcePlacement of sourcePlacements) {
            if (
              sourcePlacement.activePlacement === placement.placementName ||
              (sourcePlacement.targetPlacement && sourcePlacement.targetPlacement.includes(placement.placementName))
            ) {
              const placedClone = placement.placeInto(sourcePlacement.parent);
              placedChildren.push(placedClone);
            }
          }

          const sourceKey = `placement:${placement.placementName}`;
          node.removeLayer('children', sourceKey);
          if (placedChildren.length > 0) {
            node.addLayer(new NodeLayer('children', sourceKey, 'append', placedChildren, this.phase));
          }
        }
      }
    }
  }

  /**
   * Updates `node.lastCompletedPhase` and emits downstream to component routing.
   *
   * @param node Successfully processed host Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('placementAssembly');
    Supervisor.emitToPhaseName(this, node, _rollbackState || {}, 'componentRouting');
  }
}
