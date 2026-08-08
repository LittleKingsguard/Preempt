import { Component } from "../Component.js";
import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import { NodeQueryUtils } from "../utils/NodeQueryUtils.js";
import { WorkerMessage } from "../WorkerMessage.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

/**
 * Worker handling Phase 4 (Slot Assembly) of the Supervisor pipeline.
 *
 * @useCase Applies non-type component bindings (targeting props, styles, handlers, or slot contents) into target nodes.
 * @processFlow Fourth worker stage executed after Phase 3 Component Assembly.
 */
export class SlotAssemblyWorker extends BaseWorker {
  /** Phase 4 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('slotAssembly');

  /**
   * Emits eligible nodes with slot component bindings or assembly handlers to Phase 2 (ComponentRoutingWorker) processing.
   *
   * @param node Target node or tree branch root.
   * @param rollbackState Optional rollback snapshot.
   * @param recursive If `true`, recursively checks child nodes.
   * @useCase Triggering slot assembly stage for specific nodes.
   * @processFlow Phase 4 event emission helper.
   */
  public static emitTo(node: Node, recursive: boolean = false): void {
    if (!Supervisor.instance || !Supervisor.instance.slotAssemblyWorker) return;
    const isMatch = (n: Node) => {
      const hasSlotComponent = (n.targetComponents && Array.from(n.targetComponents.values()).some(c => c.target !== "type")) ||
        (n.component && n.component.some(c => c.target !== "type"));
      const hasHandlers = n.handlers && n.handlers.some(h => h.phase === "beforeAssembly" || h.phase === "afterAssembly");
      return Boolean(hasSlotComponent || hasHandlers);
    };
    const matchingNodes = recursive ? NodeQueryUtils.findNodes(node, isMatch) : (isMatch(node) ? [node] : []);
    for (const match of matchingNodes) {
      if (match.isInTree && match.lastCompletedPhase !== 4) {
        const slotRefs: string[] = [];
        if (match.targetComponents) {
          for (const [k, v] of match.targetComponents) {
            if (v.target !== "type") slotRefs.push(k);
          }
        }
        const msg = new WorkerMessage('SlotAssemblyWorker', 'ComponentRoutingWorker');
        msg.addInstruction('createdNew', slotRefs.length > 0 ? slotRefs : ['slot']);
        match.addMessage(msg);
        Supervisor.emitToPhaseName(this, match, 'componentRouting');
      }
    }
  }

  /**
   * Processes non-type component bindings and injects resolved property values into target node paths.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node): Promise<void> {
    console.log(`[SlotAssemblyWorker] Processing node: ${node.type} | ID: ${node.props?.id}`, node);

    // Phase 4: Slot Assembly

    const messages = node.getMessages('SlotAssemblyWorker', true);
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

    if (node.targetComponents.size === 0) {
      node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
      if (messages) messages.forEach(m => m.markComplete());
      return;
    }

    const sortedComponents: any[] = [];
    for (const c of node.targetComponents.values()) {
      if (c.target === "type") continue;

      const matchesTarget = targetKeys && c.target && targetKeys.has(c.target);
      const matchesSource = sourceReferences && c.reference && sourceReferences.has(c.reference);

      if (!hasInstructions || matchesTarget || matchesSource) {
        sortedComponents.push(c);
      }
    }

    if (sortedComponents.length === 0) {
      node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
      if (messages) messages.forEach(m => m.markComplete());
      return;
    }

    for (const binding of sortedComponents) {
      const sourceName = `component:${binding.target || binding.reference}`;
      node.removeLayersForSource(sourceName);

      if (binding.target === 'children' && Component.isAppliedInAncestors(node, binding)) {
        console.error(`[SlotAssemblyWorker] Loop safeguard: Component '${binding.reference}' targeting '${binding.target}' has already been applied by an ancestor node of '${node.css?.id || node.type}'. Terminating slot assembly for this component.`);
        continue;
      }

      const { resolvedValue, resolvedBinding } = binding.resolveBinding();

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${binding.reference}' targeting '${binding.target}'`);
        continue;
      }

      const activeComp = resolvedBinding || binding;
      const targetProp = activeComp.target || binding.target || 'children';
      activeComp.buildLayerMap(this.phase, targetProp);
      node.addLayer(activeComp.layerMap, this.phase);
    }

    if (messages) {
      for (const msg of messages) {
        msg.markComplete();
      }
    }

    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }



  /**
   * Updates `node.lastCompletedPhase` to 4 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('slotAssembly');
  }
}
