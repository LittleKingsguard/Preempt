import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";

/**
 * Worker handling Phase 7 (Tree Assembly) for Client-Side DOM hierarchy construction.
 *
 * @useCase Mounts created elements into their parent container DOM nodes, orders child elements correctly, and removes unmounted DOM nodes.
 * @processFlow Eighth worker stage executed after Phase 6 Client Element Creation on browser runtime environments.
 * @queueEmissions Events are emitted to Phase 7 queue automatically by `ClientElementCreationWorker.onProcessSuccess()` upon completion of Phase 6 Element Creation.
 */
export class ClientTreeAssemblyWorker extends BaseWorker {
  /** Phase 7 identifier. */
  public readonly phase = 7;

  /**
   * Processes the tree assembly worker queue sequentially.
   *
   * @returns Promise resolving when tree assembly completes.
   */
  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;
    await super.processQueue();
  }

  /**
   * Processes tree assembly for a single Node instance and triggers `afterRender` handlers.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
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

  /**
   * Helper method appending and re-ordering child DOM elements within the host element.
   *
   * @param node Target host Node instance.
   */
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

    // Ensure node is mounted in parent's DOM element at the correct index, or mounted to root container if root
    if (node.parent === null) {
      if (!el.parentNode) {
        const mountId = (node.props?.id as string) || node.css?.id || 'app';
        const mountTarget = document.getElementById(mountId) || document.body;
        if (mountTarget && el !== mountTarget) {
          mountTarget.appendChild(el);
        }
      }
    } else if (node.parent && node.parent.element) {
      const parentEl = node.parent.element;
      if (node.parent.children && Array.isArray(node.parent.children)) {
        const childIndex = node.parent.children.indexOf(node);
        if (childIndex > -1) {
          if (el.parentNode !== parentEl) {
            parentEl.appendChild(el);
          }
          const expectedNode = parentEl.children[childIndex];
          if (expectedNode !== el) {
            parentEl.insertBefore(el, expectedNode || null);
          }
        }
      }
    }
  }

  /**
   * Updates `node.lastCompletedPhase` to 7 upon success.
   *
   * @param node Successfully assembled Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 7;
  }
}

