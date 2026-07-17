const fs = require('fs');

let content = fs.readFileSync('/media/ryan/Shared Files1/Projects/Preempt/src/core/workers/ComponentAssemblyWorker.ts', 'utf8');

const regex = /\/\/ Phase 2: Component Assembly[\s\S]*?(?=\n    let typeName = node\.type)/;

const replacement = `// Phase 2: Component Assembly
    // This phase applies all target components

    const targets = Array.from(node.targetComponents.entries());
    if (targets.length > 0) {
      const nextState: any = {};
      let addedNew = false;
      let newCss = node.css ? Node.deepClone(node.css) : {};
      let newProps = node.props ? Node.deepClone(node.props) : {};
      let newHandlers = node.handlers ? Node.deepClone(node.handlers) : {};
      let newCompiledHandlers = { ...node.compiledHandlers };
      let newSourceComponents = new Map(node.sourceComponents);
      let newTargetComponents = new Map(node.targetComponents);
      let newChildren = [...node.children];
      let newContent = node.content;

      targets.sort((a, b) => {
        if (a[0] === "type" && b[0] !== "type") return -1;
        if (a[0] !== "type" && b[0] === "type") return 1;
        return 0;
      });

      for (const [target, component] of targets) {
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
          console.error(\`Component binding failed: Could not resolve value for reference '\${component.reference}' targeting '\${component.target}'\`);
          continue;
        }

        if (target === "type") {
          const dataArray = Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];

          if (component._clonedChildren) {
            newChildren = newChildren.filter(c => !component._clonedChildren!.includes(c));
          }
          component._clonedChildren = [];
          
          if (component._appendedContent && newContent !== undefined && typeof newContent === 'string') {
            newContent = newContent.replace(component._appendedContent, "");
          }
          component._appendedContent = "";

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
                component._clonedChildren!.push(clonedChild);
              }

              if (instantiatedNode.content !== undefined) {
                if (newContent !== undefined) {
                  newContent += instantiatedNode.content as string;
                } else {
                  newContent = instantiatedNode.content as string;
                }
                component._appendedContent += instantiatedNode.content as string;
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
                  newTargetComponents.set(k, v);
                  if (k === "type") addedNew = true;
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
                newChildren.push(instantiatedNode.cloneInstantiated(node));
              } else if (typeof resolvedValue[i] === "object" && resolvedValue[i] !== null) {
                newChildren.push(new Node(resolvedValue[i], node, true));
              }
            }
          } else if (typeof resolvedValue === "object" && resolvedValue !== null) {
            newContent = undefined;
            let instantiatedNode = resolvedBinding?._instantiatedNodes?.[0];
            if (instantiatedNode) {
              newChildren = [instantiatedNode.cloneInstantiated(node)];
            } else {
              newChildren = [new Node(resolvedValue, node, true)];
            }
          } else {
            newContent = String(resolvedValue);
            newChildren = [];
          }
          addedNew = true;
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
      }

      if (newChildren.length !== node.children.length || newChildren.some((c, i) => c !== node.children[i])) {
         nextState.children = newChildren;
      }
      if (newContent !== node.content) {
         nextState.content = newContent;
      }

      if (Object.keys(nextState).length > 0) {
        node.receiveNextState(nextState);
        if (addedNew) {
          this.push(node, rollbackState);
          return;
        }
      }
    }`;

fs.writeFileSync('/media/ryan/Shared Files1/Projects/Preempt/src/core/workers/ComponentAssemblyWorker.ts', content.replace(regex, replacement));
