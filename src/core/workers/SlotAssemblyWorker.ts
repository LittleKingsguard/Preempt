import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState, HandlerDef } from "../../types/NodeSchema.js";
import { clientAPI } from "../ClientAPI.js";
import { CloneUtils } from "../utils/CloneUtils.js";
import { Handler } from "../Handler.js";
import { Css } from "../Css.js";


export class SlotAssemblyWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[SlotAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);
    // Phase 3: Slot Assembly
    // Locks all other components (content, props, handlers, css)

    if (node.targetComponents.size === 0) {
      node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
      return;
    }

    const sortedComponents: any[] = [];
    for (const c of node.targetComponents.values()) {
      if (c.target !== "type") {
        sortedComponents.push(c);
      }
    }

    if (sortedComponents.length === 0) {
      node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
      return;
    }




    // Base collections that might be modified
    let newCss = node.css ? node.css.clone() : new Css();
    let newProps = node.props ? CloneUtils.deepClone(node.props) : {};
    let newHandlers: Record<string, Handler> = {};
    if (node.handlers) {
      for (const [k, v] of Object.entries(node.handlers)) {
        newHandlers[k] = v.clone();
      }
    }

    for (const binding of sortedComponents) {
      if (!binding.target) continue;

      let { resolvedValue, resolvedBinding } = binding.resolveBinding();

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${binding.reference}' targeting '${binding.target}'`);
        continue;
      }

      if (typeof resolvedValue === "string") {
        this.applyProperty(binding.target, resolvedValue, node, newProps, newHandlers, newCss);
      } else if (typeof resolvedValue === "object" && resolvedValue !== null && binding.target.startsWith("handlers.")) {
        this.applyProperty(binding.target, resolvedValue as unknown as string | HandlerDef, node, newProps, newHandlers, newCss);
      } else if (binding.target === "content") {
        if (Array.isArray(resolvedValue)) {
          node.children = [];
          for (let i = 0; i < resolvedValue.length; i++) {
            const instantiatedNode = resolvedBinding?._instantiatedNodes?.[i];
            if (instantiatedNode) {
              const clonedChild = instantiatedNode.clone([], ['element', '_referencingNodes']);
              clonedChild.parent = node;
              node.nativeChildren.push(clonedChild);
              node.invalidateChildrenCache();

              const emitTree = (n: Node) => {
                if (n.component) n.setComponents(n.component);
                Supervisor.emitToPhase(n, {}, 2);
                if (n.children) {
                  for (const c of n.children) emitTree(c);
                }
              };
              emitTree(clonedChild);
            } else if (typeof resolvedValue[i] === "object" && resolvedValue[i] !== null) {
              console.warn(`[SlotAssemblyWorker] Skipping raw NodeData for content slot on node ${node.css?.id}. Raw nodes must be properly instantiated into _instantiatedNodes before slot assembly.`);
            }
          }
        } else if (typeof resolvedValue === "object" && resolvedValue !== null) {
          node.content = undefined;
          let instantiatedNode = resolvedBinding?._instantiatedNodes?.[0];
          if (instantiatedNode) {
            const clonedChild = instantiatedNode.clone([], ['element', '_referencingNodes']);
            clonedChild.parent = node;
            node.children = [clonedChild];

            const emitTree = (n: Node) => {
              if (n.component) n.setComponents(n.component);
              Supervisor.emitToPhase(n, {}, 2);
              if (n.children) {
                for (const c of n.children) emitTree(c);
              }
            };
            emitTree(clonedChild);
          } else {
            console.warn(`[SlotAssemblyWorker] Skipping raw NodeData for content slot on node ${node.css?.id}. Raw nodes must be properly instantiated into _instantiatedNodes before slot assembly.`);
          }
        } else {
          node.content = String(resolvedValue);
          node.children = [];
        }
      } else {
        console.warn(`Target ${binding.target} expected string value but received object for reference ${binding.reference}`);
      }
    }

    // Changes are emitted directly through onProcessSuccess
    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }

  private applyProperty(
    path: string,
    value: string | HandlerDef,
    node: Node,
    newProps: any,
    newHandlers: any,
    newCss: any
  ): void {
    if (path === "content") {
      node.content = value as string;
    } else if (path.startsWith("props.")) {
      const propName = path.substring(6);
      if (node.props?.[propName] !== (value as string)) {
        newProps[propName] = value as string;
        node.props = newProps;
      }
    } else if (path.startsWith("handlers.")) {
      const handlerName = path.substring(9);
      const isDifferent = typeof value === 'string' 
        ? node.handlers?.[handlerName]?.body !== value
        : node.handlers?.[handlerName]?.body !== value.body || node.handlers?.[handlerName]?.name !== value.name || node.handlers?.[handlerName]?.event !== value.event;
        
      if (isDifferent) {
        newHandlers[handlerName] = new Handler(value, handlerName);
        node.handlers = newHandlers;
      }
    } else if (path.startsWith("css.style.")) {
      const styleName = path.substring(10);
      if (!newCss.style) newCss.style = {};
      if (node.css?.style?.[styleName] !== (value as string)) {
        newCss.style[styleName] = value as string;
        node.css = newCss;
      }
    } else if (path.startsWith("css.classes.")) {
      const className = path.substring(12);
      if (!newCss.classes) newCss.classes = node.css?.classes ? [...node.css.classes] : [];
      const hasClass = newCss.classes.includes(className);

      if (value === "true" && !hasClass) {
        newCss.classes.push(className);
        node.css = newCss;
      } else if (value === "false" && hasClass) {
        newCss.classes = newCss.classes.filter((c: string) => c !== className);
        node.css = newCss;
      }
    }
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 3;
    Supervisor.emitToPhase(node, _rollbackState || {}, 4);
  }
}
