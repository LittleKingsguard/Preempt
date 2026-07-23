import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { Supervisor } from "../Supervisor.js";

export class SSRElementCreationWorker extends BaseWorker {
  public readonly phase = 6;

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined || !node.isInTree) {
      console.error(`[SSRElementCreationWorker] Error: Node reached Element Creation phase with parent === undefined or isInTree === false`, node);
      return;
    }
    console.log(`[SSRElementCreationWorker] Processing node element: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 6: SSR Element Creation
    node.executeHandlers("beforeRender", { supervisor: this.supervisor }, false);
    
    // Create element fragment representation for single node
    (node as any).ssrElement = SSRElementCreationWorker.renderNodeElementToString(node);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 6;
    Supervisor.emitToPhase(this, node, _rollbackState || {}, 7);
  }

  public static renderNodeElementToString(node: Node): { openTag: string; closeTag: string; contentText: string; isVoid: boolean } {
    if (!node.isValid) return { openTag: "", closeTag: "", contentText: "", isVoid: false };

    const tag = (node.type || "div").toLowerCase();
    let attributes = "";

    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        if (key === 'id' || key === 'class' || key === 'style') continue;
        const escapedValue = String(value).replace(/"/g, '&quot;');
        attributes += ` ${key}="${escapedValue}"`;
      }
    }

    if (node.handlers && Array.isArray(node.handlers)) {
      for (const handlerObj of node.handlers) {
        if (!handlerObj.event) continue;
        const eventName = handlerObj.event.startsWith('on') ? handlerObj.event.toLowerCase() : `on${handlerObj.event.toLowerCase()}`;
        const handlerBody = handlerObj.body;
        const trimmedValue = String(handlerBody || '').trim();
        let jsCode = trimmedValue;
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          jsCode = `(${trimmedValue})(event, { node: null, metadata: null, rootNode: null })`;
        }
        const escapedCode = jsCode.replace(/"/g, '&quot;');
        attributes += ` ${eventName}="${escapedCode}"`;
      }
    }

    if (node.css) {
      if (node.css.id) attributes += ` id="${node.css.id}"`;
      if (node.css.classes && node.css.classes.length > 0) {
        attributes += ` class="${node.css.classes.join(' ')}"`;
      }
      if (node.css.style && Object.keys(node.css.style).length > 0) {
        const styleStr = Object.entries(node.css.style)
          .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${v}`)
          .join('; ');
        attributes += ` style="${styleStr}"`;
      }
    }

    const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const isVoid = voidElements.has(tag);

    let contentText = "";
    if (typeof node.content === 'string') {
      contentText = node.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    return {
      openTag: `<${tag}${attributes}>`,
      closeTag: isVoid ? "" : `</${tag}>`,
      contentText,
      isVoid
    };
  }
}
