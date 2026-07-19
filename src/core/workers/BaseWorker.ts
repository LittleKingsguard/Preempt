import { Node } from "../Node.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Supervisor } from "../Supervisor.js";

export abstract class BaseWorker {
  protected queue: Map<Node, RollbackState | undefined> = new Map();
  protected supervisor: Supervisor;

  constructor(supervisor: Supervisor) {
    this.supervisor = supervisor;
  }

  public push(node: Node, rollbackState?: RollbackState): void {
    this.queue.set(node, rollbackState);
  }

  public hasEvents(): boolean {
    return this.queue.size > 0;
  }

  public async processQueue(): Promise<void> {
    let iter = 0;
    while (this.hasEvents()) {
      if (++iter > 500) { console.error("INFINITE LOOP IN WORKER", this.constructor.name); break; }
      const currentQueue = new Map(this.queue);
      this.queue.clear();

      for (const [node, rollbackState] of currentQueue.entries()) {
        try {
          await this.processNode(node, rollbackState);
          this.onProcessSuccess(node, rollbackState);
        } catch (err) {
          console.error(`[${this.constructor.name}] Worker error on node ${node.css?.id || 'unknown'}:`, err);
          node.rollback(rollbackState);
        }
      }
    }
  }

  protected abstract processNode(node: Node, rollbackState?: RollbackState): Promise<void>;
  protected abstract onProcessSuccess(node: Node, rollbackState?: RollbackState): void;
}
