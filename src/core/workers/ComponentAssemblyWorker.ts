import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Handler } from "../Handler.js";
import { Placement } from "../Placement.js";
import { Props } from "../Props.js";
import { Css } from "../Css.js";
import { Supervisor } from "../Supervisor.js";
import { WorkerMessage } from "../WorkerMessage.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

/**
 * Worker handling Phase 3 (Component Assembly) of the Supervisor pipeline.
 *
 * @useCase Resolves structural component bindings targeting `"type"`, deep-merging sub-tree layouts into target hosting nodes.
 * @processFlow Third worker stage executed after Phase 2 Component Routing. Triggers `beforeAssembly` and `afterAssembly` lifecycle handlers.
 */
export class ComponentAssemblyWorker extends BaseWorker {
  /** Phase 3 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('componentAssembly');

  /**
   * Processes structural component resolution and deep-merging into the target node.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    console.log(`[ComponentAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);

    const messages = node.getMessages('ComponentAssemblyWorker', true);
    const hasInstructions = messages && messages.length > 0;

    let targetKeys: Set<string> | null = null;
    let sourceReferences: Set<string> | null = null;
    if (hasInstructions) {
      targetKeys = new Set<string>();
      sourceReferences = new Set<string>();
      for (const msg of messages) {
        const created = msg.instructions.get('createdNew');
        if (created) created.forEach(t => targetKeys!.add(t));
        const updated = msg.instructions.get('updatedSource');
        if (updated) updated.forEach(r => sourceReferences!.add(r));
      }
    }

    node.executeHandlers("beforeAssembly", { supervisor: this.supervisor }, false);

    // Phase 3: Component Assembly
    // This phase applies the 'type' component specifically.

    const typeComponent = node.targetComponents.get("type");
    const matchesTarget = targetKeys && (
      targetKeys.has("type") ||
      (Boolean(typeComponent?.target) && targetKeys.has(typeComponent!.target!)) ||
      (Boolean(typeComponent?.reference) && targetKeys.has(typeComponent!.reference!))
    );
    const matchesSource = sourceReferences && Boolean(typeComponent?.reference) && sourceReferences.has(typeComponent!.reference!);

    if (typeComponent && (!hasInstructions || matchesTarget || matchesSource)) {
      typeComponent.rollback = node.clone(['parent', 'children', '_childrenCache', 'element'], [], null, 99, false, 'ComponentAssemblyWorkerRollback');
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
        if (hasInstructions) {
          this.resetNodeToOriginals(node);
        }
      } else if (Array.isArray(resolvedValue)) {
        console.error(`Component binding failed: Cannot resolve an array for a 'type' target component.`);
        if (hasInstructions) {
          this.resetNodeToOriginals(node);
        }
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
                child.clone([], [], node, this.phase, false, 'ComponentAssemblyWorker');
              }
            }

            if (componentRootNode.content !== undefined) {
              newContent = componentRootNode.content;
            }

            if (componentRootNode.css) {
              node.css = componentRootNode.css.clone([], node, 'ComponentAssemblyWorker');
            }

            if (componentRootNode.props) {
              node.props = componentRootNode.props.clone([], node, 'ComponentAssemblyWorker');
            }

            if (componentRootNode.handlers && Array.isArray(componentRootNode.handlers)) {
              if (!node.handlers) node.handlers = [];
              for (const h of componentRootNode.handlers) {
                node.handlers.push(h.clone(node, this.phase));
              }
            }

            if (componentRootNode.placement && Array.isArray(componentRootNode.placement)) {
              const clonedPlacements = componentRootNode.placement.map((p: Placement) => p.clone([], node, this.phase, 'ComponentAssemblyWorker'));
              node.placement = clonedPlacements;
            }

            if (componentRootNode.sourceComponents.size > 0 || componentRootNode.targetComponents.size > 0) {
              const addedSourceNames: string[] = [];
              const addedTargetNames: string[] = [];

              for (const [k, v] of componentRootNode.sourceComponents) {
                if (!newSourceComponents.has(k)) {
                  addedSourceNames.push(k);
                }
                newSourceComponents.set(k, v);
              }
              for (const [k, v] of componentRootNode.targetComponents) {
                if (!newTargetComponents.has(k) || newTargetComponents.get(k) !== v) {
                  addedTargetNames.push(k);
                  newTargetComponents.set(k, v);
                }
              }
              node.setComponents([
                ...Array.from(newSourceComponents.values()),
                ...Array.from(newTargetComponents.values())
              ], 3);

              if (addedSourceNames.length > 0 || addedTargetNames.length > 0) {
                const routingMsg = new WorkerMessage('ComponentAssemblyWorker', 'ComponentRoutingWorker');
                if (addedTargetNames.length > 0) {
                  routingMsg.addInstruction('createdNew', addedTargetNames);
                }
                if (addedSourceNames.length > 0) {
                  routingMsg.addInstruction('updatedSource', addedSourceNames);
                }
                node.addMessage(routingMsg);
                Supervisor.emitToPhaseName(this, node, _rollbackState || {}, 'componentRouting');
              }
            }
          } else if (hasInstructions) {
            this.resetNodeToOriginals(node);
          }
        }
      }

      if (newContent !== node.content) {
        node.content = newContent;
      }
    }

    if (messages) {
      for (const msg of messages) {
        msg.markComplete();
      }
    }

    // Cascade updates to referencing nodes for any source components on node
    for (const sourceComp of node.sourceComponents.values()) {
      if (sourceComp._referencingNodes && sourceComp._referencingNodes.size > 0) {
        const { resolvedValue } = sourceComp.resolveBinding();
        const nextStatePayload = (typeof resolvedValue === 'object' && resolvedValue !== null)
          ? resolvedValue
          : { [sourceComp.target || 'content']: resolvedValue };
        for (const refNode of sourceComp._referencingNodes) {
          Object.assign(refNode, nextStatePayload);
          const routingMsg = new WorkerMessage('ComponentAssemblyWorker', 'ComponentRoutingWorker');
          routingMsg.addInstruction('updatedSource', [sourceComp.reference || sourceComp.target || 'component']);
          refNode.addMessage(routingMsg);
          Supervisor.emitToPhaseName(this, refNode, _rollbackState || {}, 'componentRouting');
        }
      }
    }

    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }

  /**
   * Resets node properties and children back to original node.data definitions.
   *
   * @param node Target node to restore.
   */
  private resetNodeToOriginals(node: Node): void {
    node.type = node.data.type || 'div';
    node.content = node.data.content;
    node.props = new Props(node.data.props || {}, node);
    node.css = new Css(node.data.css || {}, node);
    if (node.data.handlers && Array.isArray(node.data.handlers)) {
      node.handlers = node.data.handlers.map(h => Handler.fromDef(h, node, this.phase));
    } else {
      node.handlers = [];
    }
    node.setComponents(node.data.component, this.phase);
    node.children = [];
    node.nativeChildren = [];
    if (node.data.children && Array.isArray(node.data.children)) {
      for (const childData of node.data.children) {
        new Node(childData, node, this.phase, node.isInTree);
      }
    }
  }

  /**
   * Updates `node.lastCompletedPhase` to 3 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('componentAssembly');
  }
}
