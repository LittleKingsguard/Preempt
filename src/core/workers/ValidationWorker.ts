import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";

/**
 * Worker handling Phase 5 (Validation) of the Supervisor pipeline.
 *
 * @useCase Verifies structural integrity, required HTML properties (e.g. `img.src`, `a.href`), and style schema definitions before rendering. All nodes must be sent through Phase 5 Validation in order to render; the render stage is not pushed to directly.
 * @processFlow Sixth worker stage executed after Phase 4 Preprocessing. Validates node state and automatically emits validated nodes to Phase 6 Element Creation. Triggers `beforeValidate` and `afterValidate` handlers.
 * @queueEmissions Events are emitted to Phase 5 queue automatically during `Node` construction when `isInTree === true`, when property changes occur via `node.receiveNextState()` (default target phase 5 for props, css, type updates), or when Phase 4 Preprocessing completes.
 */
export class ValidationWorker extends BaseWorker {
  /** Phase 5 identifier. */
  public readonly phase = 5;

  /**
   * Processes node validation checks during Phase 5.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   * @throws Error if node validation fails.
   */
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

  /**
   * Updates `node.lastCompletedPhase` to 5 upon success and automatically emits node to Phase 6 (Element Creation).
   *
   * @param node Successfully validated Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    if (!node.isInTree) return;
    node.lastCompletedPhase = 5;
    Supervisor.emitToPhase(this, node, _rollbackState || {}, 6);
  }

  /**
   * Static validation helper evaluating node type presence, required HTML attributes, and StyleNode schemas.
   *
   * @param node Node instance to validate.
   * @returns `true` if valid, `false` otherwise.
   * @useCase Structural node validation check.
   * @processFlow Phase 5 validation rule evaluation.
   */
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

