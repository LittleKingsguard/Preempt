import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";
import { clientAPI } from "../ClientAPI.js";

export class ComponentAssemblyWorker extends BaseWorker {
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[ComponentAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);
    node.executeHandlers("beforeAssembly", { supervisor: this.supervisor }, false);

    // Phase 2: Component Assembly
    // This phase applies the 'type' component specifically.

    const typeComponent = node.targetComponents.get("type");
    if (typeComponent) {

      let newCss = node.css ? Node.deepClone(node.css) : {};
      let newProps = node.props ? Node.deepClone(node.props) : {};
      let newHandlers = node.handlers ? Node.deepClone(node.handlers) : {};
      let newCompiledHandlers = new Map(node.compiledHandlers);
      let newSourceComponents = new Map(node.sourceComponents);
      let newTargetComponents = new Map(node.targetComponents);

      let newContent = node.content;
      let { resolvedValue, resolvedBinding } = clientAPI.resolveComponentBinding(typeComponent, node);

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
              const clonedChild = Node.deepClone(child, [], ['element', '_referencingNodes']);
              clonedChild.parent = node;
              node.children.push(clonedChild);

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
              if (newContent !== undefined) {
                newContent += instantiatedNode.content as string;
              } else {
                newContent = instantiatedNode.content as string;
              }
            }

            if (instantiatedNode.css) {
              if (instantiatedNode.css.style) newCss.style = { ...newCss.style, ...instantiatedNode.css.style };
              if (instantiatedNode.css.classes) newCss.classes = [...new Set([...(newCss.classes || []), ...instantiatedNode.css.classes])];
              if (instantiatedNode.css.cssDef) {
                newCss.cssDef = [...(newCss.cssDef || []), ...instantiatedNode.css.cssDef];
                for (const def of instantiatedNode.css.cssDef) {
                  node.styleNodes.push(new StyleNode(def, node));
                }
              }
              node.css = newCss;
            }

            if (instantiatedNode.props) {
              newProps = { ...newProps, ...instantiatedNode.props };
              node.props = newProps;
            }
            if (instantiatedNode.handlers) {
              newHandlers = { ...newHandlers, ...instantiatedNode.handlers };
              node.handlers = newHandlers;
            }
            if (instantiatedNode.compiledHandlers) {
              for (const [key, val] of instantiatedNode.compiledHandlers.entries()) {
                newCompiledHandlers.set(key, val);
              }
              node.compiledHandlers = newCompiledHandlers;
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
  }
}
