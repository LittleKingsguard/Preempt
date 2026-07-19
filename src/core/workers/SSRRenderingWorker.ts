import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";

export class SSRRenderingWorker extends BaseWorker {
  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;

    if ((this.supervisor as any).config?.runRendering !== false) {
      (this.supervisor as any).executeHandlers("beforeRender");
    }

    await super.processQueue();

    if ((this.supervisor as any).config?.runRendering !== false) {
      const rootNode = (this.supervisor as any).rootNode;
      if (rootNode) {
        let cssString = SSRRenderingWorker.renderStyleNodesToString(StyleNode.cssDefs);
        let htmlString = SSRRenderingWorker.renderToString(rootNode);
        (this.supervisor as any).ssrResult = `<style id="preempt-dynamic-styles">${cssString}</style>${htmlString}`;
      }
    }

    if ((this.supervisor as any).config?.runRendering !== false) {
      (this.supervisor as any).executeHandlers("afterRender");
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    // Phase 6: SSR Rendering
    node.executeHandlers("beforeRender", { supervisor: this.supervisor }, false);
    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {
    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, 7);
    }
  }

  public static renderToString(node: Node): string {
    if (!node.isValid) return "";

    const tag = node.type || "div";
    let attributes = "";

    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        const escapedValue = String(value).replace(/"/g, '&quot;');
        attributes += ` ${key}="${escapedValue}"`;
      }
    }

    if (node.handlers) {
      for (const [key, value] of Object.entries(node.handlers)) {
        const eventName = key.startsWith('on') ? key.toLowerCase() : `on${key.toLowerCase()}`;
        const handlerBody = typeof value === 'object' && value !== null && 'body' in value ? (value as any).body : String(value);
        const trimmedValue = String(handlerBody).trim();
        let jsCode = trimmedValue;
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          jsCode = `(${trimmedValue})(event, { node: null, metadata: null, rootNode: null })`;
        }
        const escapedValue = jsCode.replace(/"/g, '&quot;');
        attributes += ` ${eventName}="${escapedValue}"`;
      }
    }

    if (node.css) {
      if (node.css.id) attributes += ` id="${node.css.id}"`;
      if (node.css.classes && node.css.classes.length > 0) {
        attributes += ` class="${node.css.classes.join(" ")}"`;
      }
      if (node.css.style) {
        const styleStr = Object.entries(node.css.style)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v}`)
          .join("; ");
        if (styleStr) attributes += ` style="${styleStr}"`;
      }
    }

    let innerHTML = "";
    if (node.content !== undefined) {
      innerHTML += node.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    for (const child of node.children) {
      innerHTML += SSRRenderingWorker.renderToString(child);
    }

    const voidElements = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
    if (voidElements.includes(tag.toLowerCase())) {
      return `<${tag}${attributes}>`;
    }

    return `<${tag}${attributes}>${innerHTML}</${tag}>`;
  }

  public static renderStyleNodesToString(styleNodes: any[]): string {
    let cssString = "";
    for (const sNode of styleNodes) {
      if (sNode.data && sNode.data.styles && sNode.data.selector) {
        const styles = Object.entries(sNode.data.styles)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v};`)
          .join(" ");
        cssString += `${sNode.data.selector} { ${styles} }`;
      }
    }
    return cssString;
  }
}
