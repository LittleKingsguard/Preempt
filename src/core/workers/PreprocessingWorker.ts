import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";

import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";

export class PreprocessingWorker extends BaseWorker {
  public readonly phase = 4;

  public static emitTo(node: Node, rollbackState: RollbackState = {}, recursive: boolean = false): void {
    if (!Supervisor.instance || !Supervisor.instance.preprocessingWorker) return;
    const isMatch = (n: Node) => {
      return Boolean(n.handlers && n.handlers.some(h => h.phase === "beforePreprocess" || h.phase === "afterPreprocess" || h.event === "beforePreprocess" || h.event === "afterPreprocess"));
    };
    const matchingNodes = recursive ? NodeQueryUtils.findNodes(node, isMatch) : (isMatch(node) ? [node] : []);
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 4) {
        Supervisor.instance.preprocessingWorker.push(match, rollbackState);
      }
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[PreprocessingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 4: Preprocessing
    node.executeHandlers("beforePreprocess", { supervisor: this.supervisor });
    // Any preprocessing logic
    node.executeHandlers("afterPreprocess", { supervisor: this.supervisor });
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 4;
  }
}
