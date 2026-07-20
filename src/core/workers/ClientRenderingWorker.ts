import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Supervisor } from "../Supervisor.js";
import { clientAPI } from "../ClientAPI.js";
import { StyleNode } from "../StyleNode.js";

export class ClientRenderingWorker extends BaseWorker {
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
  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;

    if (this.supervisor.config?.runRendering !== false) {
      this.supervisor.executeHandlers("beforeRender");
    }

    await super.processQueue();

    if (typeof window !== 'undefined' && this.supervisor.config?.runRendering !== false) {
      ClientRenderingWorker.renderStyles();
    }

    if (this.supervisor.config?.runRendering !== false) {
      this.supervisor.executeHandlers("afterRender");
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined) return;
    console.log(`[ClientRenderingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 6: Rendering
    node.executeHandlers("beforeRender", { supervisor: this.supervisor }, false);
    
    if (typeof window !== 'undefined' && this.supervisor.config?.runRendering !== false) {
      this.renderNode(node);
    }
    
    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  private renderNode(node: Node): HTMLElement | null {
    if (typeof document === 'undefined') return null;

    let oldElement = node.element;

    if (!oldElement && !node.parent) {
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

    if (node.handlers) {
      for (const [key, value] of Object.entries(node.handlers)) {
        try {
          let handlerFunc: EventListener;
          const handlerObj = value as any;
          const context = { node: node, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI };

          let fn: Function | undefined;
          if (typeof handlerObj === 'object' && handlerObj !== null && 'name' in handlerObj) {
            fn = clientAPI.getHandler(handlerObj.name, node);
          } else if (typeof handlerObj === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(handlerObj)) {
            fn = clientAPI.getHandler(handlerObj, node);
          } else {
            fn = clientAPI.getHandler(key, node);
          }

          if (fn) {
            handlerFunc = ((event: Event) => fn!(event, context)) as EventListener;
          } else {
            const handlerBody = typeof handlerObj === 'object' && handlerObj !== null && 'body' in handlerObj ? handlerObj.body : String(handlerObj);
            const trimmedValue = handlerBody.trim();
            if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
              fn = new Function('return ' + trimmedValue)();
              handlerFunc = ((event: Event) => fn!(event, context)) as EventListener;
            } else {
              fn = new Function('event', 'context', trimmedValue);
              handlerFunc = ((event: Event) => fn!(event, context)) as EventListener;
            }
          }
          const eventName = key.startsWith('on') ? key.substring(2).toLowerCase() : key.toLowerCase();
          el.addEventListener(eventName, handlerFunc);
          node._attachedListeners.push({ eventName, handlerFunc });
        } catch (err) {
          console.error(`Failed to parse handler for event ${key}:`, err);
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

    if (node.placement?.placementName) {
      if (!node.children || node.children.length === 0) {
        el.style.display = 'none';
      } else if (el.style.display === 'none' && node.css?.style?.['display'] !== 'none') {
        el.style.display = (node.css?.style?.['display'] as string) || '';
      }
    }

    if (node.content) {
      if (typeof node.content === "string") {
        el.textContent = node.content;
      }
    }

    if (["input", "textarea", "select"].includes(targetTag)) {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const inputKey = node.props?.inputKey || node.css?.id || node.data.css?.id;
      if (inputKey) {
        if (Node.globalMetadata[inputKey] !== undefined) {
          inputEl.value = Node.globalMetadata[inputKey];
        } else if (node.content !== undefined && typeof node.content === "string") {
          inputEl.value = node.content;
          Node.globalMetadata[inputKey] = node.content;
        }

        if (!oldElement || !shouldReuse) {
          el.addEventListener('input', (event: Event) => {
            const target = event.target as HTMLInputElement;
            Node.globalMetadata[inputKey] = target.value;
          });
        }
      }
    }

    const activeChildElements = new Set<HTMLElement>();
    if (node.children && Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child) continue;

        if (!child.element) {
          this.push(child);
        } else {
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
    }

    const domChildren = Array.from(el.children);
    for (const domChild of domChildren) {
      if (!activeChildElements.has(domChild as HTMLElement)) {
        domChild.remove();
      }
    }

    if (oldElement && oldElement !== el) {
      if (oldElement.parentNode) {
        oldElement.replaceWith(el);
      } else {
        oldElement.remove();
      }
    }

    if (node.parent) {
      if (!node.parent.element) {
        this.push(node.parent);
      } else if (el.parentNode !== node.parent.element) {
        node.parent.element.appendChild(el);
      }
    } else if (!el.parentNode) {
      document.body.appendChild(el);
    }

    return el;
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 6;
    Supervisor.emitToPhase(node, _rollbackState || {}, 7);
  }
}
