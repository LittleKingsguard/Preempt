import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

export class ClientTreeAssemblyWorker extends BaseWorker {
  public readonly phase = 7;

  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;
    await super.processQueue();
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined || !node.isInTree) {
      console.error(`[ClientTreeAssemblyWorker] Error: Node reached Tree Assembly phase with parent === undefined or isInTree === false`, node);
      return;
    }
    console.log(`[ClientTreeAssemblyWorker] Assembling DOM tree for node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 7: Tree Assembly
    if (typeof window !== 'undefined' && this.supervisor.config?.runRendering !== false) {
      this.assembleTree(node);
    }

    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  private assembleTree(node: Node): void {
    if (typeof document === 'undefined') return;

    const el = node.element;
    if (!el) return;

    const activeChildElements = new Set<HTMLElement>();
    if (node.children && Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child || !child.element) continue;

        activeChildElements.add(child.element);
        if (child.element.parentNode !== el) {
          el.appendChild(child.element);
        }
        
        const expectedNode = el.children[i];
        if (expectedNode !== child.element) {
          el.insertBefore(child.element, expectedNode || null);
        }
      }
    }

    const domChildren = Array.from(el.children);
    for (const domChild of domChildren) {
      if (!activeChildElements.has(domChild as HTMLElement)) {
        domChild.remove();
      }
    }

    // If root node (parent === null), ensure mounted in DOM container if detached
    if (node.parent === null && !el.parentNode) {
      const mountId = (node.props?.id as string) || node.css?.id || 'app';
      const mountTarget = document.getElementById(mountId) || document.body;
      if (mountTarget && el !== mountTarget) {
        mountTarget.appendChild(el);
      }
    }
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 7;
  }
}
