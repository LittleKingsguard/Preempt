import { Component } from "../Component.js";
import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
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
  protected async processNode(node: Node): Promise<void> {
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
      const sourceName = `component:${typeComponent.target || typeComponent.reference}`;
      node.removeLayersForSource(sourceName);

      if (Component.isAppliedInAncestors(node, typeComponent)) {
        console.error(`[ComponentAssemblyWorker] Loop safeguard: Component '${typeComponent.reference}' has already been applied by an ancestor node of '${node.css?.id || node.type}'. Terminating component assembly for this node.`);
        return;
      }

      const { resolvedValue, resolvedBinding } = typeComponent.resolveBinding();

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${typeComponent.reference}' targeting '${typeComponent.target}'`);
      } else if (Array.isArray(resolvedValue)) {
        console.error(`Component binding failed: Cannot resolve an array for a 'type' target component.`);
      } else {
        const activeComp = resolvedBinding || typeComponent;
        const targetProp = activeComp.target || typeComponent.target || 'type';
        activeComp.buildLayerMap(this.phase, targetProp);
        node.addLayer(activeComp.layerMap, this.phase);
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
          Supervisor.emitToPhaseName(this, refNode, 'componentRouting');
        }
      }
    }

    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }



  /**
   * Updates `node.lastCompletedPhase` to 3 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('componentAssembly');
  }
}
