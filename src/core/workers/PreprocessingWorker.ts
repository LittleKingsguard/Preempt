import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";

/**
 * Worker handling Phase 5 (Preprocessing) of the Supervisor pipeline.
 *
 * @useCase Executes custom preprocessing algorithms and triggers `beforePreprocess` and `afterPreprocess` lifecycle handlers.
 * @processFlow Sixth worker stage executed after Phase 4 Slot Assembly.
 * @queueEmissions Events are emitted to Phase 5 queue when Phase 4 Slot Assembly completes for an in-tree node, when `content`/`children` properties update via `node.receiveNextState()`, or when `PreprocessingWorker.emitTo()` matches nodes with `beforePreprocess`/`afterPreprocess` handlers.
 */
export class PreprocessingWorker extends BaseWorker {
  /** Phase 5 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('preprocessing');

  /**
   * Emits eligible nodes with preprocess lifecycle handlers to Phase 5 processing.
   *
   * @param node Target node or tree branch root.
   * @param rollbackState Optional rollback snapshot.
   * @param recursive If `true`, recursively checks child nodes.
   * @useCase Triggering preprocessing stage for specific nodes.
   * @processFlow Phase 5 event emission helper.
   */
  public static emitTo(node: Node, recursive: boolean = false): void {
    if (!Supervisor.instance || !Supervisor.instance.preprocessingWorker) return;
    const isMatch = (n: Node): boolean => Boolean(n.handlers && n.handlers.some(h => h.phase === "beforePreprocess" || h.phase === "afterPreprocess"));
    const matchingNodes = recursive ? NodeQueryUtils.findNodes(node, isMatch) : (isMatch(node) ? [node] : []);
    const prepPhase = PhaseRegistry.getPhaseNumber('preprocessing');
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== prepPhase) {
        Supervisor.emitToPhaseName(this, match, 'preprocessing');
      }
    }
  }

  /**
   * Processes a node during Phase 5 preprocessing.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node): Promise<void> {
    console.log(`[PreprocessingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 5: Preprocessing
    node.executeHandlers("beforePreprocess", { supervisor: this.supervisor });
    // Any preprocessing logic
    node.executeHandlers("afterPreprocess", { supervisor: this.supervisor });
  }

  /**
   * Updates `node.lastCompletedPhase` to 5 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('preprocessing');
  }
}

