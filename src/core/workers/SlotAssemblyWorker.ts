import { Node } from "../Node.js";
import { Handler } from "../Handler.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState, HandlerDef } from "../../types/NodeSchema.js";
import { CloneUtils } from "../utils/CloneUtils.js";
import { Css } from "../Css.js";


import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";

export class SlotAssemblyWorker extends BaseWorker {
  public readonly phase = 3;

  public static emitTo(node: Node, rollbackState: RollbackState = {}, recursive: boolean = false): void {
    if (!Supervisor.instance || !Supervisor.instance.slotAssemblyWorker) return;
    const isMatch = (n: Node) => {
      const hasSlotComponent = (n.targetComponents && Array.from(n.targetComponents.values()).some(c => c.target !== "type")) ||
        (n.component && n.component.some(c => c.target !== "type"));
      const hasHandlers = n.handlers && n.handlers.some(h => h.phase === "beforeAssembly" || h.phase === "afterAssembly");
      return Boolean(hasSlotComponent || hasHandlers);
    };
    const matchingNodes = recursive ? NodeQueryUtils.findNodes(node, isMatch) : (isMatch(node) ? [node] : []);
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 3) {
        Supervisor.instance.slotAssemblyWorker.push(match, rollbackState);
      }
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[SlotAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);
    // Phase 3: Slot Assembly

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
    let newHandlers: any = {};

    for (const binding of sortedComponents) {
      binding.rollback = {
        content: node.content,
        props: CloneUtils.deepClone(node.props),
        css: node.css ? node.css.clone() : undefined
      };

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
        if (Array.isArray(resolvedValue) || (typeof resolvedValue === "object" && resolvedValue !== null)) {
          node.content = undefined;
          node.children = [];
          const clonedChildren = resolvedBinding ? resolvedBinding.cloneNode(node, node.lastCompletedPhase || 0) : [];
          for (const clonedChild of clonedChildren) {
            clonedChild.isInTree = node.isInTree;

            SlotAssemblyWorker.emitTo(clonedChild, _rollbackState || {}, false);
          }
        } else {
          node.content = String(resolvedValue);
          node.children = [];
        }
      } else {
        console.warn(`Target ${binding.target} expected string value but received object for reference ${binding.reference}`);
      }
    }

    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }

  private applyProperty(
    path: string,
    value: string | HandlerDef,
    node: Node,
    newProps: any,
    _newHandlers: any,
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
      if (!node.handlers) node.handlers = [];
      node.handlers.push(Handler.fromDef(value as any, node, node.lastCompletedPhase || 0, path));
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
  }
}
