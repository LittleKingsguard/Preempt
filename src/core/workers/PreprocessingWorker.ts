import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PreprocessingWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 4: Preprocessing
    node.executeHandlers("beforePreprocess", { supervisor: this.supervisor }, false);
    // Any preprocessing logic
    node.executeHandlers("afterPreprocess", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 5);
    }
  }
}
