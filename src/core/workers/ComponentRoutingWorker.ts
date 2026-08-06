import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import { PhaseRegistry } from "../PhaseRegistry.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { WorkerMessage } from "../WorkerMessage.js";

/**
 * Worker handling Phase 2 (Component Routing) of the Supervisor pipeline.
 *
 * @useCase Evaluates target and source component changes on nodes and routes targeted assembly instructions to ComponentAssemblyWorker (Phase 3) or SlotAssemblyWorker (Phase 4), while cascading source component updates down node.children.
 * @processFlow Second worker stage executed after Phase 1 Placement.
 */
export class ComponentRoutingWorker extends BaseWorker {
  /** Phase 2 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('componentRouting');

  /**
   * Processes routing instructions for component bindings and updates.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 2: Component Routing
    const messages = node.getMessages('ComponentRoutingWorker', true);
    if (!messages || messages.length === 0) {
      return;
    }

    const componentAssemblyTargets: string[] = [];
    const componentAssemblyReferences: string[] = [];
    const slotAssemblyTargets: string[] = [];
    const slotAssemblyReferences: string[] = [];

    for (const msg of messages) {
      // 1. Handle createdNew action (target keys)
      const createdTargets = msg.instructions.get('createdNew');
      if (createdTargets && createdTargets.length > 0) {
        for (const targetName of createdTargets) {
          const comp = node.targetComponents.get(targetName) ||
                       (node.component ? node.component.find(c => c.target === targetName) : undefined);
          const compTarget = comp ? comp.target : targetName;
          if (compTarget === 'type') {
            componentAssemblyTargets.push(targetName);
          } else {
            slotAssemblyTargets.push(targetName);
          }
        }
      }

      // 2. Handle updatedSource action (reference names)
      const updatedRefs = msg.instructions.get('updatedSource');
      if (updatedRefs && updatedRefs.length > 0) {
        for (const refName of updatedRefs) {
          const comp = node.sourceComponents.get(refName) ||
                       (node.component ? node.component.find(c => c.reference === refName) : undefined);
          if (comp) {
            if (comp.target === 'type') {
              componentAssemblyReferences.push(refName);
            } else {
              slotAssemblyReferences.push(refName);
            }
          }
        }

        // Cascade updatedSource message to direct children
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            const childMsg = new WorkerMessage('ComponentRoutingWorker', 'ComponentRoutingWorker');
            childMsg.addInstruction('updatedSource', updatedRefs);
            child.addMessage(childMsg);
            Supervisor.emitToPhaseName(this, child, {}, 'componentRouting');
          }
        }
      }

      msg.markComplete();
    }

    // Emit to ComponentAssemblyWorker (Phase 3)
    if (componentAssemblyTargets.length > 0 || componentAssemblyReferences.length > 0) {
      const assemblyMsg = new WorkerMessage('ComponentRoutingWorker', 'ComponentAssemblyWorker');
      if (componentAssemblyTargets.length > 0) {
        assemblyMsg.addInstruction('createdNew', Array.from(new Set(componentAssemblyTargets)));
      }
      if (componentAssemblyReferences.length > 0) {
        assemblyMsg.addInstruction('updatedSource', Array.from(new Set(componentAssemblyReferences)));
      }
      node.addMessage(assemblyMsg);
      Supervisor.emitToPhaseName(this, node, _rollbackState || {}, 'componentAssembly');
    }

    // Emit to SlotAssemblyWorker (Phase 4)
    if (slotAssemblyTargets.length > 0 || slotAssemblyReferences.length > 0) {
      const slotMsg = new WorkerMessage('ComponentRoutingWorker', 'SlotAssemblyWorker');
      if (slotAssemblyTargets.length > 0) {
        slotMsg.addInstruction('createdNew', Array.from(new Set(slotAssemblyTargets)));
      }
      if (slotAssemblyReferences.length > 0) {
        slotMsg.addInstruction('updatedSource', Array.from(new Set(slotAssemblyReferences)));
      }
      node.addMessage(slotMsg);
      Supervisor.emitToPhaseName(this, node, _rollbackState || {}, 'slotAssembly');
    }
  }

  /**
   * Updates `node.lastCompletedPhase` to 2 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('componentRouting');
  }
}
