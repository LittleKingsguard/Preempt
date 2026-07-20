import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PreprocessingWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 4: Preprocessing
    node.executeHandlers("beforePreprocess", { supervisor: this.supervisor }, false);
    // Any preprocessing logic
    node.executeHandlers("afterPreprocess", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 4;
    Supervisor.emitToPhase(node, _rollbackState || {}, 5);
  }
}
