import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Supervisor } from "../Supervisor.js";
import { clientAPI } from "../ClientAPI.js";
import { StyleNode } from "../StyleNode.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

/**
 * Worker handling Phase 7 (Element Creation) for Client-Side DOM rendering.
 *
 * @useCase Creates, configures, and binds event listeners to native browser HTML elements (`HTMLElement`).
 * @processFlow Seventh worker stage executed after Phase 6 Validation on client runtime environments.
 * @queueEmissions Events are emitted to Phase 7 queue automatically by `ValidationWorker.onProcessSuccess()` upon successful completion of Phase 6 Validation for an in-tree node. Direct pushes to Phase 7 are prohibited.
 */
export class ClientElementCreationWorker extends BaseWorker {
  /** Phase 7 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('elementCreation');

  /**
   * Inject or update dynamic CSS rules inside the `<style id="preempt-dynamic-styles">` element in document head.
   *
   * @useCase Dynamically updating browser stylesheets during client rendering.
   * @processFlow Client rendering style injection.
   */
  public static renderStyles(): void {
    if (typeof document === 'undefined') return;
    let styleEl = document.getElementById("preempt-dynamic-styles") as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "preempt-dynamic-styles";
      document.head.appendChild(styleEl);
    }
    const sheet = styleEl.sheet;
    if (sheet) {
      for (const sNode of StyleNode.cssDefs.values()) {
        if (sNode.ruleIndex === -1) {
          try {
            sNode.render(sheet);
          } catch (err) {
            console.error("Failed to render style rule", sNode.data, err);
          }
        }
      }
    }
  }

  /**
   * Processes the worker queue and triggers dynamic stylesheet injection upon queue completion.
   *
   * @returns Promise resolving when element creation is finished.
   */
  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;

    if (this.supervisor.config?.runRendering !== false) {
      this.supervisor.executeHandlers("beforeRender");
    }

    await super.processQueue();

    if (typeof window !== 'undefined' && this.supervisor.config?.runRendering !== false) {
      ClientElementCreationWorker.renderStyles();
    }
  }

  /**
   * Processes element creation for a single Node instance.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined || !node.isInTree) {
      console.error(`[ClientElementCreationWorker] Error: Node reached Element Creation phase with parent === undefined or isInTree === false`, node);
      return;
    }
    console.log(`[ClientElementCreationWorker] Creating element for node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 7: Element Creation
    node.executeHandlers("beforeRender", { supervisor: this.supervisor }, false);

    if (typeof window !== 'undefined' && this.supervisor.config?.runRendering !== false) {
      this.createElement(node);
    }
  }


  private createElement(node: Node): HTMLElement | null {
    if (typeof document === 'undefined') return null;

    let oldElement = node.element;

    if (!oldElement && node.parent === null) {
      const mountId = (node.props?.id as string) || node.css?.id || 'app';
      oldElement = document.getElementById(mountId);
    }

    if (!node.isValid) {
      if (oldElement) {
        oldElement.remove();
        node.element = null;
      }
      return null;
    }

    const targetTag = (node.type || "div").toLowerCase();
    const shouldReuse = oldElement && oldElement.tagName.toLowerCase() === targetTag;
    const el = shouldReuse ? oldElement! : document.createElement(targetTag);
    node.element = el;

    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        el.setAttribute(key, String(value));
      }
    }

    if (shouldReuse && el) {
      for (const listener of node._attachedListeners) {
        el.removeEventListener(listener.eventName, listener.handlerFunc);
      }
    }
    node._attachedListeners = [];

    if (node.handlers && Array.isArray(node.handlers)) {
      for (const handlerObj of node.handlers) {
        try {
          if (!handlerObj.event) continue;
          const rawEvent = handlerObj.event;
          const eventName = rawEvent.startsWith('on') ? rawEvent.substring(2).toLowerCase() : rawEvent.toLowerCase();

          const handlerFunc = (event: Event) => {
            const context = { node: node, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI };
            if (handlerObj && typeof handlerObj.execute === 'function') {
              handlerObj.execute(event, context);
            } else {
              let fn = handlerObj.compiled || clientAPI.getHandler(handlerObj.name, node);
              if (fn) {
                fn(event, context);
              }
            }
          };
          el.addEventListener(eventName, handlerFunc);
          node._attachedListeners.push({ eventName, handlerFunc });
        } catch (err) {
          console.error(`Failed to parse handler for event ${handlerObj.event}:`, err);
        }
      }
    }

    if (node.css) {
      if (node.css.id) el.id = node.css.id;
      if (node.css.classes) {
        el.classList.add(...node.css.classes);
      }
      if (node.css.style) {
        for (const [key, value] of Object.entries(node.css.style)) {
          (el.style as any)[key] = value;
        }
      }
    }

    if (node.placement?.some(p => p.placementName)) {
      if (!node.children || node.children.length === 0) {
        el.style.display = 'none';
      } else if (el.style.display === 'none' && node.css?.style?.['display'] !== 'none') {
        el.style.display = (node.css?.style?.['display'] as string) || '';
      }
    }

    if (typeof node.content === 'string') {
      el.textContent = node.content;
    }

    if (["input", "textarea", "select"].includes(targetTag)) {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const inputKey = node.props?.inputKey || node.css?.id || node.data.css?.id;
      if (inputKey) {
        if (Node.globalMetadata[inputKey] !== undefined) {
          inputEl.value = Node.globalMetadata[inputKey];
        } else if (typeof node.content === 'string') {
          const contentStr = node.content;
          inputEl.value = contentStr;
          Node.globalMetadata[inputKey] = contentStr;
        }

        if (!oldElement || !shouldReuse) {
          el.addEventListener('input', (event: Event) => {
            const target = event.target as HTMLInputElement;
            Node.globalMetadata[inputKey] = target.value;
          });
        }
      }
    }

    return el;
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('elementCreation');
    Supervisor.emitToPhaseName(this, node, _rollbackState || {}, 'treeAssembly');
  }
}
