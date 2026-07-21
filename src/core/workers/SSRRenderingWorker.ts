import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import { Supervisor } from "../Supervisor.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";

export class SSRRenderingWorker extends BaseWorker {
  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;

    if (this.supervisor.config?.runRendering !== false) {
      this.supervisor.executeHandlers("beforeRender");
    }

    await super.processQueue();

    if (this.supervisor.config?.runRendering !== false) {
      const rootNode = this.supervisor.rootNode;
      if (rootNode) {
        let cssString = SSRRenderingWorker.renderStyleNodesToString(Array.from(StyleNode.cssDefs.values()));
        let htmlString = SSRRenderingWorker.renderToString(rootNode);
        this.supervisor.ssrResult = `<style id="preempt-dynamic-styles">${cssString}</style>${htmlString}`;
      }
    }

    if (this.supervisor.config?.runRendering !== false) {
      this.supervisor.executeHandlers("afterRender");
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined) return;
    console.log(`[SSRRenderingWorker] Processing node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 6: SSR Rendering
    node.executeHandlers("beforeRender", { supervisor: this.supervisor }, false);
    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 6;
    Supervisor.emitToPhase(node, _rollbackState || {}, 7);
  }

  public static renderToString(node: Node): string {
    if (!node.isValid) return "";

    const tag = node.type || "div";
    let attributes = "";

    if (node.props) {
      for (const [key, value] of Object.entries(node.props)) {
        if (key === 'id' || key === 'class' || key === 'style') continue;
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

    let computedStyle: Record<string, any> = {};
    if (node.css && node.css.style) {
       computedStyle = { ...node.css.style };
    }
    if (node.placement?.some(p => p.placementName) && (!node.children || node.children.length === 0)) {
       computedStyle['display'] = 'none';
    }

    if (node.css) {
      if (node.css.id) attributes += ` id="${node.css.id}"`;
      if (node.css.classes && node.css.classes.length > 0) {
        attributes += ` class="${node.css.classes.join(" ")}"`;
      }
    }

    if (Object.keys(computedStyle).length > 0) {
      const styleStr = Object.entries(computedStyle)
        .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v}`)
        .join("; ");
      if (styleStr) attributes += ` style="${styleStr}"`;
    }

    let innerHTML = "";
    if (node.content !== undefined) {
      innerHTML += node.content.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) {
          innerHTML += SSRRenderingWorker.renderToString(child);
        }
      }
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
