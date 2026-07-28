import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";

import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";

/**
 * Worker handling Phase 4 (Preprocessing) of the Supervisor pipeline.
 *
 * @useCase Executes custom preprocessing algorithms and triggers `beforePreprocess` and `afterPreprocess` lifecycle handlers.
 * @processFlow Fifth worker stage executed after Phase 3 Slot Assembly.
 * @queueEmissions Events are emitted to Phase 4 queue when Phase 3 Slot Assembly completes for an in-tree node, when `content`/`children` properties update via `node.receiveNextState()`, or when `PreprocessingWorker.emitTo()` matches nodes with `beforePreprocess`/`afterPreprocess` handlers.
 */
export class PreprocessingWorker extends BaseWorker {
  /** Phase 4 identifier. */
  public readonly phase = 4;

  /**
   * Emits eligible nodes with preprocessing handlers to Phase 4 processing.
   *
   * @param node Target node or tree branch root.
   * @param rollbackState Optional rollback snapshot.
   * @param recursive If `true`, recursively checks child nodes.
   * @useCase Triggering preprocessing stage for specific nodes.
   * @processFlow Phase 4 event emission helper.
   */
  public static emitTo(node: Node, rollbackState: RollbackState = {}, recursive: boolean = false): void {
    if (!Supervisor.instance || !Supervisor.instance.preprocessingWorker) return;
    const isMatch = (n: Node) => {
      return Boolean(n.handlers && n.handlers.some(h => h.phase === "beforePreprocess" || h.phase === "afterPreprocess" || h.event === "beforePreprocess" || h.event === "afterPreprocess"));
    };
    const matchingNodes = recursive ? NodeQueryUtils.findNodes(node, isMatch) : (isMatch(node) ? [node] : []);
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 4) {
        Supervisor.emitToPhase(this, match, rollbackState, 4);
      }
    }
  }

  /**
   * Processes a node during Phase 4 preprocessing.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[PreprocessingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 4: Preprocessing
    node.executeHandlers("beforePreprocess", { supervisor: this.supervisor });
    // Any preprocessing logic
    node.executeHandlers("afterPreprocess", { supervisor: this.supervisor });
  }

  /**
   * Updates `node.lastCompletedPhase` to 4 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 4;
  }
}

