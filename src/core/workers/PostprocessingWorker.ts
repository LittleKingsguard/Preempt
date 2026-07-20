import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class PostprocessingWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 7: Postprocessing
    node.executeHandlers("beforePostprocess", { supervisor: this.supervisor }, false);
    // Any postprocessing logic
    node.executeHandlers("afterPostprocess", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 7;

  }
}
