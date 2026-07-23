import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";


export class InstantiationWorker extends BaseWorker {
  public readonly phase = 0;

  public regenerateNode(existingNode: Node): Node {
    const data = existingNode.exportToJson();
    const newNode = new Node(data, existingNode.parent, 0);

    if (existingNode.parent) {
      const index = existingNode.parent.nativeChildren.indexOf(existingNode);
      if (index > -1) {
        existingNode.parent.nativeChildren[index] = newNode;
        existingNode.parent.invalidateChildrenCache();
      }
    }

    return newNode;
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 0: Instantiation trigger
    console.log(`[InstantiationWorker] Node instantiated successfully: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 0;
  }
}
