import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class ValidationWorker extends BaseWorker {
  public readonly phase = 5;

  public static emitTo(node: Node, rollbackState: RollbackState = {}): void {
    if (!Supervisor.instance || !Supervisor.instance.validationWorker) return;
    const worker = Supervisor.instance.validationWorker;
    const emitRecursive = (n: Node) => {
      if (n.isInTree && n.lastCompletedPhase !== 5) {
        worker.push(n, rollbackState);
      }
      if (n.children && Array.isArray(n.children)) {
        for (const child of n.children) {
          if (child) emitRecursive(child);
        }
      }
    };
    emitRecursive(node);
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (!node.isInTree) return;
    console.log(`[ValidationWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
    // Phase 5: Validation
    node.executeHandlers("beforeValidate", { supervisor: this.supervisor }, false);
    
    const valid = ValidationWorker.validateNode(node);
    if (!valid) {
      throw new Error(`Validation failed for node ${node.css?.id}`);
    }
    
    node.executeHandlers("afterValidate", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    if (!node.isInTree) return;
    node.lastCompletedPhase = 5;
    Supervisor.emitToPhase(this, node, _rollbackState || {}, 6);
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

    if (node.css && node.css.styleNodes) {
      for (const sNode of node.css.styleNodes) {
        if (!sNode.validate()) {
          console.error("Node validation failed: invalid StyleNode in cssDef", sNode.data);
          valid = false;
        }
      }
    }

    node.isValid = valid;
    return valid;
  }
}
