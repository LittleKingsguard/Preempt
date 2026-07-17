import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { NodeData, RollbackState } from "../../types/NodeSchema.js";
import { PlacementWorker } from "./PlacementWorker.js";
import { clientAPI } from "../ClientAPI.js";

export class InstantiationWorker extends BaseWorker {
  // Allow queueing node data instead of just instantiated nodes
  protected dataQueue: { data: NodeData, existingNode?: Node | null, callback?: (node: Node) => void }[] = [];

  public pushRaw(data: NodeData, existingNode?: Node | null, callback?: (node: Node) => void): void {
    this.dataQueue.push({ data, existingNode, callback });
  }

  public hasEvents(): boolean {
    return this.queue.size > 0 || this.dataQueue.length > 0;
  }

  private deepClone(val: any): any {
    if (val === undefined) return undefined;
    const seen = new WeakSet();
    const replacer = (k: string, v: any) => {
      if (k === 'node' || k === '_instantiatedNodes' || k === '_referencingNodes' || k === 'parent' || k === 'children' || k === 'originalParent') return undefined;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined;
        seen.add(v);
      }
      return v;
    };
    try {
      return JSON.parse(JSON.stringify(val, replacer));
    } catch (e) {
      console.warn("Cycle detected during deepClone in InstantiationWorker", e);
      return val;
    }
  }

  private regenerateTree(existingNode: Node | null, data: any): Node {
    if (existingNode && data && data.component) {
      existingNode.data.component = this.deepClone(data.component);
      existingNode.setComponents(this.deepClone(data.component));
    }
    let newNode: Node;
    if (!existingNode) {
      newNode = new Node(this.deepClone(data));
    } else if (existingNode.hasChangedSinceRender) {
      newNode = new Node(existingNode.data);
    } else {
      const newChildren = [];
      for (let i = 0; i < existingNode.children.length; i++) {
        const child = existingNode.children[i];
        if (child && !child.isComponentInjected) {
          const newChild = this.regenerateTree(child, child.data);
          newChild.parent = existingNode;
          newChildren.push(newChild);
        }
      }
      existingNode.children = newChildren;
      newNode = existingNode;
    }

    if (newNode.data.component?.some((c: any) => c.target === "type")) {
      Node.typeComponentNodes.push(newNode);
    }

    return newNode;
  }

  public async processQueue(): Promise<void> {
    // Process raw NodeData first to turn them into Nodes
    while (this.dataQueue.length > 0) {
      const currentDataQueue = [...this.dataQueue];
      this.dataQueue = [];

      for (const item of currentDataQueue) {
         try {
           const node = this.regenerateTree(item.existingNode || null, item.data);
           if (item.callback) item.callback(node);
           
           const pushAll = (n: Node) => {
              this.push(n, {}); // Add to normal node queue for appendPlacement processing
              for (const child of n.children) {
                 if (!child.isComponentInjected) {
                    pushAll(child);
                 }
              }
           };
           pushAll(node);
         } catch (err) {
           console.error(`[InstantiationWorker] Failed to instantiate node:`, err);
         }
      }
    }

    // Now process the instantiated nodes
    await super.processQueue();
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 0: Instantiation
    
    // 1. Handler Compilation
    if (node.handlers) {
      for (const [key, value] of Object.entries(node.handlers)) {
        const handlerBody = typeof value === 'object' && value !== null && 'body' in value ? value.body : String(value);
        const compiled = clientAPI.compileHandler(key, handlerBody);
        if (compiled) node.compiledHandlers[key] = compiled;
      }
    }

    if (node.component) {
      node.component.forEach((binding: any) => {
        const isHandler = typeof binding.value === 'object' && binding.value !== null && 'body' in binding.value;
        if (isHandler) {
          const handlerName = binding.value.name || binding.reference;
          const compiled = clientAPI.compileHandler(handlerName, binding.value.body);
          if (compiled) node.compiledHandlers[handlerName] = compiled;
        }
      });
    }

    // 2. Component Node Instantiation
    if (node.component) {
      for (const binding of node.component) {
        if (binding === null) continue;
        if (typeof binding.value === "object" && binding.value !== null) {
          const dataArray = Array.isArray(binding.value) ? binding.value : [binding.value];
          binding._instantiatedNodes = [];
          for (const d of dataArray) {
            if (typeof d !== "string" && !('body' in d)) {
              const newNode = this.regenerateTree(null, d);
              newNode.parent = node;
              newNode.isComponentInjected = true;
              binding._instantiatedNodes!.push(newNode);
              
              const pushAll = (n: Node) => {
                 this.push(n, {});
                 for (const child of n.children) {
                    if (!child.isComponentInjected) {
                       pushAll(child);
                    }
                 }
              };
              pushAll(newNode);
            }
          }
        }
      }
    }

    // 3. Updates global placement data so other nodes can identify them.
    // Placement arrays are locked globally after this phase by Supervisor.
    PlacementWorker.appendPlacement(node);
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    // Optionally emit to next phase if needed
    // In our architecture, the Supervisor routes to the next phase queue based on configuration
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 1); // Emit to Placement phase
    }
  }
}
