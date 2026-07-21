import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";
import { clientAPI } from "../ClientAPI.js";
import { CloneUtils } from "../utils/CloneUtils.js";
import { Css } from "../Css.js";
import { Handler } from "../Handler.js";

export class ComponentAssemblyWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[ComponentAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);
    node.executeHandlers("beforeAssembly", { supervisor: this.supervisor }, false);

    // Phase 2: Component Assembly
    // This phase applies the 'type' component specifically.

    const typeComponent = node.targetComponents.get("type");
    if (typeComponent) {

      let newCss = node.css ? node.css.clone() : new Css();
      let newProps = node.props ? CloneUtils.deepClone(node.props) : {};
      let newHandlers: Record<string, Handler> = {};
      if (node.handlers) {
        for (const [k, v] of Object.entries(node.handlers)) {
          newHandlers[k] = v.clone();
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
          const instantiatedNode = resolvedBinding?._instantiatedNodes?.[0];
          if (instantiatedNode) {
            if (instantiatedNode.type) node.type = instantiatedNode.type;

            for (const child of instantiatedNode.children) {
              const clonedChild = child.clone([], ['element', '_referencingNodes']);
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
            }

            if (instantiatedNode.content !== undefined) {
              // TODO: Implementing proper content combination logic for ContentPayload objects
              newContent = instantiatedNode.content.clone();
            }

            if (instantiatedNode.css) {
              if (instantiatedNode.css.style) newCss.style = { ...newCss.style, ...instantiatedNode.css.style };
              if (instantiatedNode.css.classes) newCss.classes = [...new Set([...(newCss.classes || []), ...instantiatedNode.css.classes])];
              if (instantiatedNode.css.styleNodes && instantiatedNode.css.styleNodes.length > 0) {
                for (const sNode of instantiatedNode.css.styleNodes) {
                  newCss.styleNodes.push(new StyleNode(CloneUtils.deepClone(sNode.data), node));
                }
              }
              node.css = newCss;
            }

            if (instantiatedNode.props) {
              newProps = { ...newProps, ...instantiatedNode.props };
              node.props = newProps;
            }
            if (instantiatedNode.handlers) {
              for (const [k, v] of Object.entries(instantiatedNode.handlers)) {
                newHandlers[k] = (v as Handler).clone();
              }
              node.handlers = newHandlers;
            }

            if (instantiatedNode.sourceComponents.size > 0 || instantiatedNode.targetComponents.size > 0) {
              for (const [k, v] of instantiatedNode.sourceComponents) newSourceComponents.set(k, v);
              for (const [k, v] of instantiatedNode.targetComponents) {
                if (!newTargetComponents.has(k) || newTargetComponents.get(k) !== v) {
                  newTargetComponents.set(k, v);
                }
              }
              node.setComponents([
                ...Array.from(newSourceComponents.values()),
                ...Array.from(newTargetComponents.values())
              ]);
            }
          }
        }
      }


      if (newContent !== node.content) {
        node.content = newContent;
      }
    }

    // afterAssembly moved to SlotAssemblyWorker
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 2;
    Supervisor.emitToPhase(node, _rollbackState || {}, 3);

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
