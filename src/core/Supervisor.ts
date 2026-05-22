import type { PipelineConfig } from "../types/Pipeline";
import type { NodeData } from "../types/NodeSchema";
import { Node } from "./Node";
import { StyleNode } from "./StyleNode";

export class Supervisor {
  private static instance: Supervisor | null = null;
  private config: PipelineConfig;
  private rootNode: Node | null = null;
  private contentNodes: Node[] = [];
  private isMonitoring: boolean = false;
  private mountElementId: string;

  private constructor(config: PipelineConfig, mountElementId: string = "app") {
    this.config = config;
    this.mountElementId = mountElementId;
  }

  public getContentNodes(): Node[] {
    return this.contentNodes;
  }

  public static async process(templateData: NodeData, contentData: NodeData[], config: PipelineConfig): Promise<void> {
    if (Supervisor.instance) {
      Supervisor.instance.pauseMonitoring();
      await Supervisor.instance.runPipeline(templateData, contentData);
      Supervisor.instance.resumeMonitoring();
    } else {
      Supervisor.instance = new Supervisor(config);
      await Supervisor.instance.runPipeline(templateData, contentData);
      if (!Supervisor.instance.config.runMonitoring) {
        Supervisor.instance.close();
      } else {
        Supervisor.instance.startMonitoring();
      }
    }
  }

  private async runPipeline(templateData: NodeData, contentData: NodeData[]): Promise<void> {
    if (this.config.runInstantiation) {
      console.log("Stage: Instantiation");
      StyleNode.clear(); // Clear before re-running
      Node.clearPlacements();
      
      this.rootNode = new Node(templateData);
      this.contentNodes = contentData.map(data => new Node(data));
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
