import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";
import { Supervisor } from "../Supervisor.js";

export class PostprocessingWorker extends BaseWorker {
  public readonly phase = 8;

  public static emitTo(node: Node, rollbackState: RollbackState = {}): void {
    if (!Supervisor.instance || !Supervisor.instance.postprocessingWorker) return;
    const matchingNodes = NodeQueryUtils.findNodes(node, (n: Node) => {
      return Boolean(n.handlers && n.handlers.some(h => h.phase === "beforePostprocess" || h.phase === "afterPostprocess"));
    });
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 8) {
        Supervisor.instance.postprocessingWorker.push(match, rollbackState);
      }
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[PostprocessingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 8: Postprocessing
    node.executeHandlers("beforePostprocess", { supervisor: this.supervisor }, false);
    // Any postprocessing logic
    node.executeHandlers("afterPostprocess", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 8;
  }
}
