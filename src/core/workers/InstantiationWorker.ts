import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

/**
 * Worker handling Phase 0 (Instantiation) of the Supervisor pipeline.
 *
 * @useCase Handles explicit node re-instantiation and data updates when structural node data changes.
 * @processFlow In first-pass population/hydration, Node construction is performed directly on load. `InstantiationWorker` (Phase 0) is only emitted to explicitly or if node data is modified via `node.receiveNextState()`.
 * @queueEmissions Events are emitted to Phase 0 queue when nodes are explicitly re-instantiated via `Supervisor.emitToPhase(caller, node, state, 0)`, or when structural node `data` changes via `node.receiveNextState()`.
 */
export class InstantiationWorker extends BaseWorker {
  /** Phase 0 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('instantiation');

  /**
   * Regenerates an existing Node by exporting its JSON state and re-instantiating a fresh Node in place.
   *
   * @param existingNode Node instance to regenerate.
   * @returns Newly instantiated Node replacing the existing node.
   * @useCase Node regeneration when state structure is updated or reset.
   * @processFlow Phase 0 instantiation helper.
   */
  public regenerateNode(existingNode: Node): Node {
    const data = existingNode.exportToJson();
    const newNode = new Node(data, existingNode.parent, 0);

    if (existingNode.parent) {
      existingNode.delete();
      existingNode.parent.invalidateCompileCache();
    }

    return newNode;
  }

  /**
   * Processes a node during Phase 0 instantiation.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node): Promise<void> {
    // Phase 0: Instantiation trigger
    console.log(`[InstantiationWorker] Node instantiated successfully: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);
  }

  /**
   * Updates `node.lastCompletedPhase` to 0 upon success.
   *
   * @param node Successfully processed Node.
   */
  protected onProcessSuccess(node: Node): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('instantiation');
  }
}

