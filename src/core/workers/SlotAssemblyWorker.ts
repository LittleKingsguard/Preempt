import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState, ComponentBinding, HandlerDef, NodeData } from "../../types/NodeSchema.js";

export class SlotAssemblyWorker extends BaseWorker {
  protected async processNode(node: Node, rollbackState?: RollbackState): Promise<void> {
    // Phase 3: Slot Assembly
    // Locks all other components (content, props, handlers, css)
    
    if (node.targetComponents.size === 0) return;

    const sortedComponents: any[] = [];
    for (const c of node.targetComponents.values()) {
      if (c.target !== "type") {
        sortedComponents.push(c);
      }
    }

    if (sortedComponents.length === 0) return;

    const nextState: any = {};
    
    // Base collections that might be modified
    let newCss = node.css ? Node.deepClone(node.css) : {};
    let newProps = node.props ? Node.deepClone(node.props) : {};
    let newHandlers = node.handlers ? Node.deepClone(node.handlers) : {};

    for (const binding of sortedComponents) {
      if (!binding.target) continue;

      let resolvedValue: string | NodeData | NodeData[] | null = binding.value !== undefined ? binding.value : null;
      let resolvedBinding: ComponentBinding | null = binding.value !== undefined ? binding : null;

      if (resolvedValue !== null) {
        if (!binding._referencingNodes) binding._referencingNodes = [];
        if (!binding._referencingNodes.includes(node)) {
          binding._referencingNodes.push(node);
        }
      }

      if (resolvedValue === null) {
        let currentParent = node.parent;
        while (currentParent) {
          const parentBinding = currentParent.sourceComponents.get(binding.reference);
          if (parentBinding) {
            resolvedValue = parentBinding.value !== undefined ? parentBinding.value : null;
            resolvedBinding = parentBinding;
            if (!parentBinding._referencingNodes) parentBinding._referencingNodes = [];
            if (!parentBinding._referencingNodes.includes(node)) {
              parentBinding._referencingNodes.push(node);
            }
            break;
          }
          currentParent = currentParent.parent;
        }
      }

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${binding.reference}' targeting '${binding.target}'`);
        continue;
      }

      if (typeof resolvedValue === "string") {
        this.applyProperty(binding.target, resolvedValue, nextState, node, newProps, newHandlers, newCss);
      } else if (typeof resolvedValue === "object" && resolvedValue !== null && binding.target.startsWith("handlers.")) {
        this.applyProperty(binding.target, resolvedValue as unknown as string | HandlerDef, nextState, node, newProps, newHandlers, newCss);
      } else if (binding.target === "content") {
        if (Array.isArray(resolvedValue)) {
          nextState.content = undefined;
          nextState.children = [];
          for (let i = 0; i < resolvedValue.length; i++) {
            const instantiatedNode = resolvedBinding?._instantiatedNodes?.[i];
            if (instantiatedNode) {
              nextState.children.push(instantiatedNode.cloneInstantiated(node));
            } else if (typeof resolvedValue[i] === "object" && resolvedValue[i] !== null) {
              // Raw NodeData, create it
              nextState.children.push(new Node(resolvedValue[i] as NodeData, node, true));
            }
          }
        } else if (typeof resolvedValue === "object" && resolvedValue !== null) {
          nextState.content = undefined;
          let instantiatedNode = resolvedBinding?._instantiatedNodes?.[0];
          if (instantiatedNode) {
            nextState.children = [instantiatedNode.cloneInstantiated(node)];
          } else {
            nextState.children = [new Node(resolvedValue as NodeData, node, true)];
          }
        } else {
          nextState.content = String(resolvedValue);
          nextState.children = [];
        }
      } else {
        console.warn(`Target ${binding.target} expected string value but received object for reference ${binding.reference}`);
      }
    }

    if (Object.keys(nextState).length > 0) {
      node.receiveNextState(nextState);
    }
  }

  private applyProperty(
    path: string, 
    value: string | HandlerDef, 
    nextState: any, 
    node: Node, 
    newProps: any, 
    newHandlers: any, 
    newCss: any
  ): void {
    if (path === "content") {
      if (node.content !== (value as string)) nextState.content = value as string;
    } else if (path.startsWith("props.")) {
      const propName = path.substring(6);
      if (node.props?.[propName] !== (value as string)) {
        newProps[propName] = value as string;
        nextState.props = newProps;
      }
    } else if (path.startsWith("handlers.")) {
      const handlerName = path.substring(9);
      if (node.handlers?.[handlerName] !== value) {
        newHandlers[handlerName] = value as string | HandlerDef;
        nextState.handlers = newHandlers;
      }
    } else if (path.startsWith("css.style.")) {
      const styleName = path.substring(10);
      if (!newCss.style) newCss.style = {};
      if (node.css?.style?.[styleName] !== (value as string)) {
        newCss.style[styleName] = value as string;
        nextState.css = newCss;
      }
    } else if (path.startsWith("css.classes.")) {
      const className = path.substring(12);
      if (!newCss.classes) newCss.classes = [];
      const originalClasses = node.css?.classes || [];
      const hasClass = originalClasses.includes(className);
      
      if (value === "true" && !hasClass) {
        newCss.classes = [...originalClasses, className];
        nextState.css = newCss;
      } else if (value === "false" && hasClass) {
        newCss.classes = originalClasses.filter(c => c !== className);
        nextState.css = newCss;
      }
    }
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 4);
    }
  }
}
