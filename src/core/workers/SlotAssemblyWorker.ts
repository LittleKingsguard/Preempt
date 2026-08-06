import { Node } from "../Node.js";
import { Handler } from "../Handler.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState, HandlerDef } from "../../types/NodeSchema.js";
import { CloneUtils } from "../utils/CloneUtils.js";
import { Css } from "../Css.js";
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
        Supervisor.emitToPhaseName(this, match, rollbackState, 'componentRouting');
      }
    }
  }

  /**
   * Processes non-type component bindings and injects resolved property values into target node paths.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
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

    // Base collections that might be modified
    let newCss = node.css ? node.css.clone([], node, 'SlotAssemblyWorker') : new Css({}, node);
    let newProps = node.props ? CloneUtils.deepClone(node.props) : {};
    let newHandlers: any = {};

    for (const binding of sortedComponents) {
      binding.rollback = {
        content: node.content,
        props: CloneUtils.deepClone(node.props),
        css: node.css ? node.css.clone([], node, 'SlotAssemblyWorker') : undefined
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
          const clonedChildren = resolvedBinding ? resolvedBinding.cloneNode(node, 2) : [];
          void clonedChildren;
        } else {
          node.content = String(resolvedValue);
          node.children = [];
        }
      } else {
        console.warn(`Target ${binding.target} expected string value but received object for reference ${binding.reference}`);
      }
    }

    if (messages) {
      for (const msg of messages) {
        msg.markComplete();
      }
    }

    node.executeHandlers("afterAssembly", { supervisor: this.supervisor }, false);
  }

  /**
   * Helper method applying a resolved property value to a specific path target (`props.*`, `css.style.*`, `handlers.*`, `content`).
   *
   * @param path Target schema path string.
   * @param value Resolved value string or handler definition.
   * @param node Host Node instance.
   * @param newProps Mutable props object copy.
   * @param _newHandlers Mutable handlers dictionary.
   * @param newCss Mutable CSS object copy.
   */
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

  /**
   * Updates `node.lastCompletedPhase` to 4 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('slotAssembly');
  }
}
