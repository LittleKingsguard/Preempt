import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Handler } from "../Handler.js";
import { Placement } from "../Placement.js";

import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";

import { SlotAssemblyWorker } from "./SlotAssemblyWorker.js";

export class ComponentAssemblyWorker extends BaseWorker {
  public readonly phase = 2;

  public static emitTo(node: Node, rollbackState: RollbackState = {}, recursive: boolean = false): void {
    if (!Supervisor.instance || !Supervisor.instance.componentAssemblyWorker) return;
    const isMatch = (n: Node) => {
      const hasTypeComponent = (n.targetComponents && n.targetComponents.has("type")) ||
        (n.component && n.component.some(c => c.target === "type"));
      const hasHandlers = n.handlers && n.handlers.some(h => h.phase === "beforeAssembly" || h.phase === "afterAssembly");
      return Boolean(hasTypeComponent || hasHandlers);
    };
    const matchingNodes = recursive ? NodeQueryUtils.findNodes(node, isMatch) : (isMatch(node) ? [node] : []);
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 2) {
        Supervisor.instance.componentAssemblyWorker.push(match, rollbackState);
      }
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[ComponentAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);
    node.executeHandlers("beforeAssembly", { supervisor: this.supervisor }, false);

    // Phase 2: Component Assembly
    // This phase applies the 'type' component specifically.

    const typeComponent = node.targetComponents.get("type");
    if (typeComponent) {
      typeComponent.rollback = node.clone(['parent', 'children', '_childrenCache', 'element'], [], null, 99);
      let newHandlers: Record<string, Handler> = {};
      if (node.handlers) {
        for (const [k, v] of Object.entries(node.handlers)) {
          newHandlers[k] = v.clone(node, node.lastCompletedPhase || 0);
        }
      }
      let newSourceComponents = new Map(node.sourceComponents);
      let newTargetComponents = new Map(node.targetComponents);

      let newContent = node.content;
      let { resolvedValue, resolvedBinding } = typeComponent.resolveBinding();

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${typeComponent.reference}' targeting '${typeComponent.target}'`);
      } else if (Array.isArray(resolvedValue)) {
        console.error(`Component binding failed: Cannot resolve an array for a 'type' target component.`);
      } else {
        const d = resolvedValue;

        if (typeof d === "string") {
          if (node.type !== d) {
            node.type = d;
          }
        } else {
          const componentRootNode = (resolvedBinding && resolvedBinding._instantiatedNodes && resolvedBinding._instantiatedNodes.length > 0)
            ? resolvedBinding._instantiatedNodes[0]
            : null;

          if (componentRootNode) {
            if (componentRootNode.type) node.type = componentRootNode.type;

            // Clone children explicitly from componentRootNode.nativeChildren
            if (componentRootNode.nativeChildren && componentRootNode.nativeChildren.length > 0) {
              for (const child of componentRootNode.nativeChildren) {
                child.clone([], [], node, this.phase);
              }
            }

            if (componentRootNode.content !== undefined) {
              newContent = componentRootNode.content;
            }

            if (componentRootNode.css) {
              node.css = componentRootNode.css.clone([], node);
            }

            if (componentRootNode.props) {
              node.props = componentRootNode.props.clone([], node);
            }

            if (componentRootNode.handlers && Array.isArray(componentRootNode.handlers)) {
              if (!node.handlers) node.handlers = [];
              for (const h of componentRootNode.handlers) {
                node.handlers.push(h.clone(node, this.phase));
              }
            }

            if (componentRootNode.placement && Array.isArray(componentRootNode.placement)) {
              const clonedPlacements = componentRootNode.placement.map((p: Placement) => p.clone([], node, this.phase));
              node.placement = clonedPlacements;
            }

            const initialComponentCount = (node.component ? node.component.length : 0);

            if (componentRootNode.sourceComponents.size > 0 || componentRootNode.targetComponents.size > 0) {
              for (const [k, v] of componentRootNode.sourceComponents) newSourceComponents.set(k, v);
              for (const [k, v] of componentRootNode.targetComponents) {
                if (!newTargetComponents.has(k) || newTargetComponents.get(k) !== v) {
                  newTargetComponents.set(k, v);
                }
              }
              node.setComponents([
                ...Array.from(newSourceComponents.values()),
                ...Array.from(newTargetComponents.values())
              ], 2);
            }

            const finalComponentCount = (node.component ? node.component.length : 0);
            if (finalComponentCount > initialComponentCount || (componentRootNode.targetComponents && componentRootNode.targetComponents.size > 0)) {
              SlotAssemblyWorker.emitTo(node, _rollbackState || {}, false);
            }
          }
        }
      }

      if (newContent !== node.content) {
        node.content = newContent;
      }
    }
    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 2;

    // Cascade updates to referencing nodes
    if (_rollbackState) {
      for (const comp of node.sourceComponents.values()) {
        if (comp._referencingNodes && comp._referencingNodes.size > 0) {
          const nextState: any = {};
          if (node.data.props && _rollbackState.props !== node.data.props) {
            nextState.props = node.data.props;
          }
          if (node.data.css && _rollbackState.css !== node.data.css) {
            nextState.css = node.data.css;
          }
          if (node.content !== undefined && _rollbackState.content !== node.content) {
            nextState.content = node.content;
          }
          if (Object.keys(nextState).length > 0) {
            for (const refNode of comp._referencingNodes) {
              refNode.receiveNextState(nextState, 1);
            }
          }
        }
      }
    }
  }
}
