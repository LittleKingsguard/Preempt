import type { PipelineConfig } from "../types/Pipeline";
import type { NodeData, ContentPayload } from "../types/NodeSchema";
import { Node } from "./Node";
import { StyleNode } from "./StyleNode";

export class Supervisor {
  private static instance: Supervisor | null = null;
  private config: PipelineConfig;
  private rootNode: Node | null = null;
  private contentNodes: Node[] = [];
  private isMonitoring: boolean = false;
  private mountElementId: string;
  private hasInstantiated: boolean = false;

  private constructor(config: PipelineConfig, mountElementId: string = "app") {
    this.config = config;
    this.mountElementId = mountElementId;
  }

  public getContentNodes(): Node[] {
    return this.contentNodes;
  }

  public static exportRootNode(): NodeData | null {
    if (Supervisor.instance && Supervisor.instance.rootNode) {
      // Un-assemble content nodes temporarily for clean export
      const removedRecords: { parent: Node, node: Node, index: number }[] = [];

      for (const sourceNode of Node.sourcePlacements) {
        if (sourceNode.parent) {
          const index = sourceNode.parent.children.indexOf(sourceNode);
          if (index > -1) {
            removedRecords.push({ parent: sourceNode.parent, node: sourceNode, index });
            sourceNode.parent.children.splice(index, 1);
          }
        }
      }

      const exported = Supervisor.instance.rootNode.exportToJson();

      // Restore content nodes
      // Sort by index ascending to ensure splice inserts at correct positions if multiple nodes were removed from same parent
      removedRecords.sort((a, b) => a.index - b.index);
      for (const record of removedRecords) {
        record.parent.children.splice(record.index, 0, record.node);
      }

      return exported;
    }
    return null;
  }

  public static resetInstantiation(): void {
    if (Supervisor.instance) {
      Supervisor.instance.hasInstantiated = false;
    }
  }

  public static async process(templateData: NodeData, contentData: ContentPayload, config: PipelineConfig): Promise<string | void> {
    if (Supervisor.instance) {
      Supervisor.instance.pauseMonitoring();
      const result = await Supervisor.instance.runPipeline(templateData, contentData);
      Supervisor.instance.resumeMonitoring();
      return result;
    } else {
      Supervisor.instance = new Supervisor(config);
      const result = await Supervisor.instance.runPipeline(templateData, contentData);
      if (!Supervisor.instance.config.runMonitoring) {
        Supervisor.instance.close();
      } else {
        Supervisor.instance.startMonitoring();
      }
      return result;
    }
  }

  private async runPipeline(templateData: NodeData, contentData: ContentPayload): Promise<string | void> {
    if (this.config.runInstantiation && !this.hasInstantiated) {
      console.log("Stage: Instantiation");
      StyleNode.clear(); // Clear before re-running
      Node.clearPlacements();
      Node.nodeCounter = 0;
      
      this.rootNode = new Node(templateData);
      this.contentNodes = contentData.content.map(data => new Node(data));
      this.hasInstantiated = true;
    }

    if (this.config.runAssembly) {
      console.log("Stage: Assembly");
      if (this.rootNode) {
        // [DEV-ONLY] TODO: Remove root data export logging before production
        console.log("Before Assembly:", this.rootNode.exportToJson());
      }
      for (const sourceNode of Node.sourcePlacements) {
        const targets = sourceNode.data.placement?.targetPlacement || [];
        let matchedTarget: Node | null = null;
        for (const targetName of targets) {
          matchedTarget = Node.placementArray.find(n => n.data.placement?.placementName === targetName) || null;
          if (matchedTarget) break;
        }
        if (matchedTarget) {
          sourceNode.placeInto(matchedTarget);
        }
      }
      if (this.rootNode) {
        if (contentData.component && contentData.component.length > 0) {
          if (!this.rootNode.data.component) {
            this.rootNode.data.component = [];
          }
          this.rootNode.data.component.push(...contentData.component);
        }
        
        this.rootNode.applyComponentsTree();
        // [DEV-ONLY] TODO: Remove root data export logging before production
        console.log("After Assembly:", this.rootNode.exportToJson());
      }
    }

    if (this.config.runPreprocessing) {
      console.log("Stage: Pre-processing");
    }

    if (this.config.runValidation) {
      console.log("Stage: Validation");
      if (this.rootNode) {
        const isValid = this.rootNode.validate();
        if (!isValid) throw new Error("Validation failed");
      }
    }

    if (this.config.runRendering) {
      console.log("Stage: Rendering");
      
      if (typeof window === 'undefined') {
        // SSR Context
        let cssString = "";
        for (const sNode of StyleNode.cssDefs) {
          cssString += sNode.renderToString();
        }
        let htmlString = "";
        if (this.rootNode) {
          htmlString = this.rootNode.renderToString();
        }
        return `<style id="preempt-dynamic-styles">${cssString}</style>${htmlString}`;
      } else {
        // Client DOM Context
        let styleEl = document.getElementById("preempt-dynamic-styles") as HTMLStyleElement;
        if (styleEl) styleEl.remove();
        
        styleEl = document.createElement("style");
        styleEl.id = "preempt-dynamic-styles";
        document.head.appendChild(styleEl);
        
        const sheet = styleEl.sheet as CSSStyleSheet;
        for (const sNode of StyleNode.cssDefs) {
          sNode.render(sheet);
        }

        if (this.rootNode) {
          const domElement = this.rootNode.render();
          const mountTarget = document.getElementById(this.mountElementId);
          if (mountTarget && domElement) {
            mountTarget.innerHTML = "";
            mountTarget.appendChild(domElement);
          }
        }
      }
    }

    if (this.config.runPostprocessing) {
      console.log("Stage: Post-processing");
    }
  }

  private startMonitoring(): void {
    this.isMonitoring = true;
    console.log("Stage: Monitoring started, state:", this.isMonitoring);
  }

  private pauseMonitoring(): void {
    this.isMonitoring = false;
    console.log("Monitoring paused, state:", this.isMonitoring);
  }

  private resumeMonitoring(): void {
    this.isMonitoring = true;
    console.log("Monitoring resumed, state:", this.isMonitoring);
  }

  private close(): void {
    console.log("Supervisor closing. Pipeline complete.");
    Supervisor.instance = null;
  }
}
