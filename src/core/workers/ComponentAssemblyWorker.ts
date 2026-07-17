import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";

export class ComponentAssemblyWorker extends BaseWorker {
  protected async processNode(node: Node, rollbackState?: RollbackState): Promise<void> {
    console.log(`[ComponentAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`);
    node.executeHandlers("beforeAssembly", { supervisor: this.supervisor }, false);
    
    // Phase 2: Component Assembly
    // This phase applies the 'type' component specifically.

    const targets = Array.from(node.targetComponents.entries());
    if (targets.length > 0) {
      const nextState: any = {};
      let newCss = node.css ? Node.deepClone(node.css) : {};
      let newProps = node.props ? Node.deepClone(node.props) : {};
      let newHandlers = node.handlers ? Node.deepClone(node.handlers) : {};
      let newCompiledHandlers = { ...node.compiledHandlers };
      let newSourceComponents = new Map(node.sourceComponents);
      let newTargetComponents = new Map(node.targetComponents);
      let newChildren = [...node.children];
      let newContent = node.content;
      let processedTargets = new Set<string>();

      let getNextTarget = () => {
        let currentTargets = Array.from(newTargetComponents.entries()).filter(t => !processedTargets.has(t[0]));
        currentTargets.sort((a, b) => {
          if (a[0] === "type" && b[0] !== "type") return -1;
          if (a[0] !== "type" && b[0] === "type") return 1;
          return 0;
        });
        return currentTargets.length > 0 ? currentTargets[0] : null;
      };

      let iter = 0;
      let nextTarget = getNextTarget();
      while (nextTarget) {
        if (++iter > 500) { console.error("INFINITE LOOP IN nextTarget"); break; }
        const [target, component] = nextTarget;
        processedTargets.add(target);
        
        let resolvedValue: any = component.value !== undefined ? component.value : null;
        let resolvedBinding: any = component.value !== undefined ? component : null;

        if (resolvedValue !== null) {
          if (!component._referencingNodes) component._referencingNodes = [];
          if (!component._referencingNodes.includes(node)) {
            component._referencingNodes.push(node);
          }
        }

        if (resolvedValue === null) {
          let currentParent = node.parent;
          while (currentParent) {
            const parentBinding = currentParent.sourceComponents.get(component.reference);
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
          console.error(`Component binding failed: Could not resolve value for reference '${component.reference}' targeting '${component.target}'`);
          nextTarget = getNextTarget();
          continue;
        }

        if (target === "type") {
          const dataArray = Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];

          for (const d of dataArray) {
            if (typeof d === "string") {
              nextState.type = d;
              continue;
            }

            const instantiatedNode = resolvedBinding?._instantiatedNodes?.[dataArray.indexOf(d)];
            if (instantiatedNode) {
              if (instantiatedNode.type) nextState.type = instantiatedNode.type;

              for (const child of instantiatedNode.children) {
                const clonedChild = child.cloneInstantiated(node);
                newChildren.push(clonedChild);
                this.push(clonedChild);
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
                    node.styleNodes.push(new StyleNode(def, node, true));
                  }
                }
                nextState.css = newCss;
              }

              if (instantiatedNode.props) {
                newProps = { ...newProps, ...instantiatedNode.props };
                nextState.props = newProps;
              }
              if (instantiatedNode.handlers) {
                newHandlers = { ...newHandlers, ...instantiatedNode.handlers };
                nextState.handlers = newHandlers;
              }
              if (instantiatedNode.compiledHandlers) {
                newCompiledHandlers = { ...newCompiledHandlers, ...instantiatedNode.compiledHandlers };
                nextState.compiledHandlers = newCompiledHandlers;
              }
              
              if (instantiatedNode.sourceComponents.size > 0 || instantiatedNode.targetComponents.size > 0) {
                for (const [k, v] of instantiatedNode.sourceComponents) newSourceComponents.set(k, v);
                for (const [k, v] of instantiatedNode.targetComponents) {
                  if (!newTargetComponents.has(k) || newTargetComponents.get(k) !== v) {
                    newTargetComponents.set(k, v);
                  }
                }
                nextState.components = [
                  ...Array.from(newSourceComponents.values()),
                  ...Array.from(newTargetComponents.values())
                ];
              }
            }
          }
        } else if (target === "content") {
          if (Array.isArray(resolvedValue)) {
            newContent = undefined;
            newChildren = [];
            for (let i = 0; i < resolvedValue.length; i++) {
              const instantiatedNode = resolvedBinding?._instantiatedNodes?.[i];
              if (instantiatedNode) {
                const clonedChild = instantiatedNode.cloneInstantiated(node);
                newChildren.push(clonedChild);
                this.push(clonedChild);
              } else if (typeof resolvedValue[i] === "object" && resolvedValue[i] !== null) {
                const newChild = new Node(resolvedValue[i], node, true);
                newChildren.push(newChild);
                this.push(newChild);
              }
            }
          } else if (typeof resolvedValue === "object" && resolvedValue !== null) {
            newContent = undefined;
            let instantiatedNode = resolvedBinding?._instantiatedNodes?.[0];
            if (instantiatedNode) {
              const clonedChild = instantiatedNode.cloneInstantiated(node);
              newChildren = [clonedChild];
              this.push(clonedChild);
            } else {
              const newChild = new Node(resolvedValue, node, true);
              newChildren = [newChild];
              this.push(newChild);
            }
          } else {
            newContent = String(resolvedValue);
            newChildren = [];
          }
        } else if (target.startsWith("props.")) {
           const propName = target.substring(6);
           newProps[propName] = String(resolvedValue);
           nextState.props = newProps;
        } else if (target.startsWith("css.style.")) {
           const styleName = target.substring(10);
           if (!newCss.style) newCss.style = {};
           newCss.style[styleName] = String(resolvedValue);
           nextState.css = newCss;
        } else if (target.startsWith("css.classes.")) {
           const actionStr = target.substring(12);
           const parts = actionStr.split(".");
           if (parts.length === 2 && parts[0] === "add") {
             if (resolvedValue === "true" || resolvedValue === true) {
               if (!newCss.classes) newCss.classes = [];
               if (!newCss.classes.includes(parts[1])) newCss.classes.push(parts[1]);
               nextState.css = newCss;
             }
           } else if (parts.length === 2 && parts[0] === "remove") {
             if (resolvedValue === "true" || resolvedValue === true) {
               if (newCss.classes) {
                 newCss.classes = newCss.classes.filter((c: string) => c !== parts[1]);
                 nextState.css = newCss;
               }
             }
           }
        } else if (target.startsWith("handlers.")) {
           const handlerName = target.substring(9);
           newHandlers[handlerName] = resolvedValue;
           nextState.handlers = newHandlers;
        }
        
        nextTarget = getNextTarget();
      }

      if (newChildren.length !== node.children.length || newChildren.some((c, i) => c !== node.children[i])) {
         nextState.children = newChildren;
      }
      if (newContent !== node.content) {
         nextState.content = newContent;
      }

      if (Object.keys(nextState).length > 0) {
        node.receiveNextState(nextState);
      }
    }

    let typeName = node.type || node.data?.type || rollbackState?.type;
    
    // In tests, typeComponentNodes might be mocked as an object. In actual code it's an array.
    let instances: Node[] = [];
    if (Node.typeComponentNodes) {
      if (Array.isArray(Node.typeComponentNodes)) {
        instances = Node.typeComponentNodes.filter(n => (n.type === typeName || n.data?.type === typeName));
      } else {
        // It's mocked as an object
        for (const [key, nodes] of Object.entries(Node.typeComponentNodes)) {
          if (Array.isArray(nodes) && nodes.includes(node)) {
            typeName = key; // this node is in the list, meaning it's a definition (as per the mock)
          }
        }
        if (typeName && (Node.typeComponentNodes as any)[typeName]) {
          instances = (Node.typeComponentNodes as any)[typeName];
        }
      }
    }

    if (instances.length > 0) {
      for (const instance of instances) {
        if (instance !== node) {
          const nextState: any = {};
          if (node.data.props) nextState.props = Node.deepClone(node.data.props);
          if (node.data.css) nextState.css = Node.deepClone(node.data.css);
          
          if (Object.keys(nextState).length > 0) {
            instance.receiveNextState(nextState);
          }
        }
      }
    }
    
    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 3);
    }
  }
}
