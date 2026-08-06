import { Node } from "../Node.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Supervisor } from "../Supervisor.js";

/**
 * Abstract base class for all 9 stage worker classes in the Supervisor pipeline.
 *
 * @useCase Foundation for worker stages (Instantiation, Placement, ComponentAssembly, SlotAssembly, Preprocessing, Validation, ElementCreation, TreeAssembly, Postprocessing).
 * @processFlow Manages queued Node instances, controls phase execution order, handles errors, and executes state rollbacks on failure.
 */
export abstract class BaseWorker {
  public queue: Map<Node, RollbackState | undefined> = new Map();
  protected isProcessing: boolean = false;
  private _supervisor?: Supervisor | undefined;

  public get supervisor(): Supervisor {
    return this._supervisor ?? Supervisor.instance!;
  }

  public set supervisor(val: Supervisor | undefined) {
    this._supervisor = val;
  }

  /** Phase ID number (0-8) associated with this worker instance. */
  public abstract readonly phase: number;

  /**
   * Constructs a BaseWorker attached to a Supervisor instance.
   *
   * @param supervisor Central Supervisor pipeline orchestrator instance.
   */
  constructor(supervisor?: Supervisor) {
    this._supervisor = supervisor;
  }

  /**
   * Pushes a Node instance into this worker's processing queue.
   *
   * @param node Virtual DOM Node to process.
   * @param rollbackState Optional rollback state snapshot to restore on error.
   * @useCase Emitting nodes to worker phases via `Supervisor.emitToPhase()`.
   * @processFlow Event queueing for stage processing.
   */
  public push(node: Node, rollbackState?: RollbackState): void {
    if (!this.queue.has(node)) {
      this.queue.set(node, rollbackState);
    }
  }

  /**
   * Checks if the worker queue contains pending nodes or is actively executing.
   *
   * @returns `true` if queue is non-empty or worker is processing, `false` otherwise.
   * @useCase Evaluated by `Supervisor` loop to verify stage completion.
   * @processFlow Pipeline scheduling check.
   */
  public hasEvents(): boolean {
    return this.queue.size > 0 || this.isProcessing;
  }

  /**
   * Processes all pending Node items in the queue sequentially.
   *
   * @returns Promise resolving when queue is drained.
   * @useCase Executed during Supervisor stage runs.
   * @processFlow Iterates queue, calls `processNode()`, triggers `onProcessSuccess()`, or executes `node.rollback()` on error.
   */
  public async processQueue(): Promise<void> {
    this.isProcessing = true;
    let iter = 0;
    try {
      while (this.queue.size > 0) {
        if (++iter > 500) { console.error("INFINITE LOOP IN WORKER", this.constructor.name); break; }
        const nextItem = this.queue.entries().next().value;
        if (!nextItem) break;
        const [node, rollbackState] = nextItem;
        this.queue.delete(node);

        try {
          if (node.lastCompletedPhase === this.phase) {
            console.log(`[${this.constructor.name}] Skipping node (already completed phase ${this.phase}): ${node.type} | ID: ${node.css?.id || 'unknown'}`);
            continue;
          }
          console.log(`[${this.constructor.name}] Processing node: ${node.type} | ID: ${node.css?.id || node.props?.id || 'unknown'}`, node);
          await this.processNode(node, rollbackState);
          this.onProcessSuccess(node, rollbackState);
        } catch (err) {
          console.error(`[${this.constructor.name}] Worker error on node ${node.css?.id || 'unknown'}:`, err);
          node.rollback(rollbackState);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Abstract method implemented by concrete worker classes to process a single node.
   *
   * @param node Node instance to process.
   * @param rollbackState Optional rollback snapshot.
   */
  protected abstract processNode(node: Node, rollbackState?: RollbackState): Promise<void>;

  /**
   * Abstract callback executed upon successful processing of a node.
   *
   * @param node Processed Node instance.
   * @param rollbackState Optional rollback snapshot.
   */
  protected abstract onProcessSuccess(node: Node, rollbackState?: RollbackState): void;
}

