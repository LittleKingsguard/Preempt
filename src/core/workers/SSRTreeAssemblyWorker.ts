import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";
import { SSRElementCreationWorker } from "./SSRElementCreationWorker.js";

export class SSRTreeAssemblyWorker extends BaseWorker {
  public readonly phase = 7;

  public async processQueue(): Promise<void> {
    if (this.queue.size === 0) return;

    await super.processQueue();

    if (this.supervisor.config?.runRendering !== false) {
      const rootNode = this.supervisor.rootNode;
      if (rootNode) {
        let cssString = SSRTreeAssemblyWorker.renderStyleNodesToString(Array.from(StyleNode.cssDefs.values()));
        let htmlString = SSRTreeAssemblyWorker.renderToString(rootNode);
        this.supervisor.ssrResult = `<style id="preempt-dynamic-styles">${cssString}</style>${htmlString}`;
      }
    }

    if (this.supervisor.config?.runRendering !== false) {
      this.supervisor.executeHandlers("afterRender");
    }
  }

  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined || !node.isInTree) {
      console.error(`[SSRTreeAssemblyWorker] Error: Node reached Tree Assembly phase with parent === undefined or isInTree === false`, node);
      return;
    }
    console.log(`[SSRTreeAssemblyWorker] Assembling HTML tree for node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 7: SSR Tree Assembly
    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = 7;
  }

  public static renderToString(node: Node): string {
    if (!node.isValid) return "";

    const elData = (node as any).ssrElement || SSRElementCreationWorker.renderNodeElementToString(node);
    if (!elData) return "";

    if (elData.isVoid) {
      return elData.openTag;
    }

    let innerHTML = elData.contentText || "";

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) {
          innerHTML += SSRTreeAssemblyWorker.renderToString(child);
        }
      }
    }

    return `${elData.openTag}${innerHTML}${elData.closeTag}`;
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
