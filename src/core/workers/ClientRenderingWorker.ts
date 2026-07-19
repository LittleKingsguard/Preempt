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
      for (const sNode of StyleNode.cssDefs) {
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

    if ((this.supervisor as any).config?.runRendering !== false) {
      (this.supervisor as any).executeHandlers("beforeRender");
    }

    await super.processQueue();

    if (typeof window !== 'undefined' && (this.supervisor as any).config?.runRendering !== false) {
      ClientRenderingWorker.renderStyles();
      const rootNode = (this.supervisor as any).rootNode;
      if (rootNode) {
        ClientRenderingWorker.render(rootNode);
      }
    }

    if ((this.supervisor as any).config?.runRendering !== false) {
      (this.supervisor as any).executeHandlers("afterRender");
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 6: Rendering
    node.executeHandlers("beforeRender", { supervisor: this.supervisor }, false);
    // DOM rendering is deferred to processQueue to avoid duplicate client side work
    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  public static render(node: Node): HTMLElement | null {
    if (typeof document === 'undefined') return null;

    const oldElement = node.element;

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
    for (const child of node.children) {
      ClientRenderingWorker.render(child);
      if (child.element) {
        activeChildElements.add(child.element);
        if (child.element.parentNode !== el) {
          el.appendChild(child.element);
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
    } else if (!oldElement) {
      if (node.parent && node.parent.element) {
        node.parent.element.appendChild(el);
      } else if (!node.parent) {
         // Mount root node to DOM
         const mountElementId = (typeof (globalThis as any).Supervisor !== 'undefined' && (globalThis as any).Supervisor.instance) ? (globalThis as any).Supervisor.instance.mountElementId : 'app';
         const appElement = document.getElementById(mountElementId);
         if (appElement && appElement !== el) {
            if (appElement.parentNode) {
                appElement.replaceWith(el);
            } else {
                appElement.appendChild(el);
            }
         } else if (!appElement) {
            document.body.appendChild(el);
         }
      }
    }

    return el;
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 7);
    }
  }
}
