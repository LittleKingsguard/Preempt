import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { NodeData, RollbackState } from "../../types/NodeSchema.js";
import { PlacementWorker } from "./PlacementWorker.js";
import { Placement } from "../Placement.js";


export class InstantiationWorker extends BaseWorker {
  // Allow queueing node data instead of just instantiated nodes
  protected dataQueue: { data: NodeData, existingNode?: Node | null | undefined, callback?: ((node: Node) => void) | undefined }[] = [];

  public pushRaw(data: NodeData, existingNode?: Node | null | undefined, callback?: ((node: Node) => void) | undefined): void {
    this.dataQueue.push({ data, existingNode, callback });
  }

  public hasEvents(): boolean {
    return this.queue.size > 0 || this.dataQueue.length > 0;
  }

  private regenerateNode(existingNode: Node | null, data: any): Node {
    const newNode = new Node(data);

    if (existingNode) {
      if (existingNode.parent) {
        const index = existingNode.parent.nativeChildren.indexOf(existingNode);
        if (index > -1) {
          existingNode.parent.nativeChildren[index] = newNode;
          existingNode.parent.invalidateChildrenCache();
          newNode.parent = existingNode.parent;
          existingNode.parent = null; // Prevent delete from splicing array
        }
      }
      existingNode.delete();
    }

    if (data.content) {
      if (Array.isArray(data.content)) {
        data.content.forEach((childData: any) => {
          this.pushRaw(childData, null, (childNode: Node) => {
            childNode.parent = newNode;
            newNode.nativeChildren.push(childNode);
            newNode.invalidateChildrenCache();
          });
        });
      } else if (typeof data.content === "object" && data.content !== null) {
        this.pushRaw(data.content, null, (childNode: Node) => {
          childNode.parent = newNode;
          newNode.nativeChildren.push(childNode);
          newNode.invalidateChildrenCache();
        });
      }
    }

    if (newNode.sourceComponents) {
      for (const binding of newNode.sourceComponents.values()) {
        if (binding._instantiatedNodes && binding._instantiatedNodes.length === 0) {
          const dataArray = Array.isArray(binding.value) ? binding.value : [binding.value];
          for (const d of dataArray) {
            if (d && typeof d !== "string" && !('body' in d)) {
              this.pushRaw(d as NodeData, null, (componentNode: Node) => {
                binding._instantiatedNodes!.push(componentNode);
              });
            }
          }
        }
      }
    }

    return newNode;

  }

  public async processQueue(): Promise<void> {
    let iter = 0;
    while (this.hasEvents()) {
      if (++iter > 500) { console.error("INFINITE LOOP IN WORKER", this.constructor.name); break; }

      // Process raw NodeData first to turn them into Nodes
      while (this.dataQueue.length > 0) {
        const currentDataQueue = [...this.dataQueue];
        this.dataQueue = [];

        for (const item of currentDataQueue) {
          try {
            const node = this.regenerateNode(item.existingNode || null, item.data);
            if (item.callback) item.callback(node);

            this.push(node, {});
          } catch (err) {
            console.error(`[InstantiationWorker] Failed to instantiate node:`, err);
          }
        }
      }

      // Process the instantiated nodes
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

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 0: Instantiation
    console.log(`[InstantiationWorker] Node instantiated successfully: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node);

    // 3. Updates global placement data so other nodes can identify them.
    // Placement arrays are locked globally after this phase by Supervisor.
    if (node.placement) node.placement.append();
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 0;
    Supervisor.emitToPhase(node, _rollbackState || {}, 1); // Emit to Placement phase
  }
}
