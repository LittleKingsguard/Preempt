import { Node } from "../Node.js";
import { BaseWorker } from "./BaseWorker.js";
import type { RollbackState } from "../../types/NodeSchema.js";
import { StyleNode } from "../StyleNode.js";
import { SSRElementCreationWorker } from "./SSRElementCreationWorker.js";
import { PhaseRegistry } from "../PhaseRegistry.js";

/**
 * Worker handling Phase 8 (Tree Assembly) for Server-Side Rendering (SSR).
 *
 * @useCase Compiles the entire virtual DOM tree into a final SSR HTML string response prefixed with `<style id="preempt-dynamic-styles">`.
 * @processFlow Eighth worker stage executed after Phase 7 SSR Element Creation in Node.js server environments.
 * @queueEmissions Events are emitted to Phase 8 queue automatically by `SSRElementCreationWorker.onProcessSuccess()` upon completion of Phase 7 SSR Element Creation.
 */
export class SSRTreeAssemblyWorker extends BaseWorker {
  /** Phase 8 identifier. */
  public readonly phase = PhaseRegistry.getPhaseNumber('treeAssembly');

  /**
   * Processes the SSR tree assembly queue, rendering final HTML and CSS strings into `supervisor.ssrResult`.
   *
   * @returns Promise resolving when SSR HTML compilation is finished.
   */
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

  /**
   * Processes a node during Phase 8 SSR tree assembly and triggers `afterRender` handlers.
   *
   * @param node Node instance to process.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected async processNode(node: Node, _rollbackState?: RollbackState): Promise<void> {
    if (node.parent === undefined || !node.isInTree) {
      console.error(`[SSRTreeAssemblyWorker] Error: Node reached Tree Assembly phase with parent === undefined or isInTree === false`, node);
      return;
    }
    console.log(`[SSRTreeAssemblyWorker] Assembling HTML tree for node: ${node.type} | ID: ${node.css?.id || 'unknown'}`, node.data, node);

    // Phase 8: SSR Tree Assembly
    node.executeHandlers("afterRender", { supervisor: this.supervisor }, false);
  }

  /**
   * Updates `node.lastCompletedPhase` to 8 upon success.
   *
   * @param node Successfully processed Node.
   * @param _rollbackState Optional rollback snapshot.
   */
  protected onProcessSuccess(node: Node, _rollbackState?: RollbackState): void {
    node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('treeAssembly');
  }

  /**
   * Recursively compiles a Node tree into a complete HTML string.
   *
   * @param node Root Node of tree or sub-tree branch.
   * @returns HTML string output.
   * @useCase Compiling complete SSR HTML responses.
   * @processFlow Phase 7 SSR HTML tree traversal.
   */
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

  /**
   * Compiles an array of StyleNode objects into a scoped CSS stylesheet string.
   *
   * @param styleNodes Array of StyleNode instances.
   * @returns Concatenated CSS string for SSR stylesheet injection.
   * @useCase SSR CSS generation.
   * @processFlow Phase 7 SSR stylesheet compilation.
   */
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

