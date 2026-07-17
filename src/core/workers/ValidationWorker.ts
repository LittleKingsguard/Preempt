import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class ValidationWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 5: Validation
    node.executeHandlers("beforeValidate", { supervisor: this.supervisor }, false);
    
    const valid = ValidationWorker.validateNode(node);
    if (!valid) {
      throw new Error(`Validation failed for node ${node.css?.id}`);
    }
    
    node.executeHandlers("afterValidate", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 7);
    }
  }

  public static validateNode(node: Node): boolean {
    let valid = true;
    if (!node.type) {
      console.error("Node validation failed: missing 'type' property", node.data);
      valid = false;
    } else {
      const requiredProps = Node.REQUIRED_PROPS_MAP[node.type.toLowerCase()];
      if (requiredProps) {
        for (const prop of requiredProps) {
          if (!node.props || !node.props[prop]) {
            console.error(`Node validation failed: '${node.type}' missing required property: '${prop}'`, node.data);
            valid = false;
          }
        }
      }
    }

    for (const sNode of node.styleNodes) {
      if (!sNode.validate()) {
        console.error("Node validation failed: invalid StyleNode in cssDef", sNode.data);
        valid = false;
      }
    }

    node.isValid = valid;
    return valid;
  }
}
