import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";
import { Supervisor } from "../Supervisor.js";

/**
 * Worker handling Phase 8 (Postprocessing) of the Supervisor pipeline.
 *
 * @useCase Executes post-rendering application cleanup, analytics triggers, or custom postprocessing hooks (`beforePostprocess`, `afterPostprocess`).
 * @processFlow Final worker stage (Ninth stage) executed after Phase 7 Tree Assembly.
 * @queueEmissions Events are emitted to Phase 8 queue automatically via `PostprocessingWorker.emitTo()` for nodes with `beforePostprocess`/`afterPostprocess` handlers after Phase 7 Tree Assembly completes.
 */
export class PostprocessingWorker extends BaseWorker {
  /** Phase 8 identifier. */
  public readonly phase = 8;

  /**
   * Emits eligible nodes with postprocessing handlers to Phase 8 processing.
   *
   * @param node Target node or tree root.
   * @param rollbackState Optional rollback snapshot.
   * @useCase Triggering postprocessing stage for specific nodes.
   * @processFlow Phase 8 event emission helper.
   */
  public static emitTo(node: Node, rollbackState: RollbackState = {}): void {
    if (!Supervisor.instance || !Supervisor.instance.postprocessingWorker) return;
    const matchingNodes = NodeQueryUtils.findNodes(node, (n: Node) => {
      return Boolean(n.handlers && n.handlers.some(h => h.phase === "beforePostprocess" || h.phase === "afterPostprocess"));
    });
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 8) {
        Supervisor.emitToPhase(this, match, rollbackState, 8);
      }
    }
  }

  /**
   * Processes postprocessing handlers for a single Node instance.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[PostprocessingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 8: Postprocessing
    node.executeHandlers("beforePostprocess", { supervisor: this.supervisor }, false);
    // Any postprocessing logic
    node.executeHandlers("afterPostprocess", { supervisor: this.supervisor }, false);
  }

  /**
   * Updates `node.lastCompletedPhase` to 8 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 8;
  }
}

