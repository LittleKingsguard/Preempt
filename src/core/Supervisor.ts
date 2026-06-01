import type { PipelineConfig } from "../types/Pipeline";
import type { NodeData, ContentPayload, UserData } from "../types/NodeSchema";
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
  public userData?: UserData;
  public serverApi?: any;
  public static currentStage: string = 'closed';

  private constructor(config: PipelineConfig, mountElementId: string = "app") {
    this.config = config;
    this.mountElementId = mountElementId;
  }

  public static getContentNodes(): Node[] {
    return Supervisor.instance ? Supervisor.instance.contentNodes : [];
  }

  public static setContentNodes(nodes: Node[]): void {
    if (Supervisor.instance) {
      Supervisor.instance.contentNodes = nodes;
    }
  }

  public static addContentNode(node: Node): void {
    if (Supervisor.instance) {
      Supervisor.instance.contentNodes.push(node);
    }
  }

  public static removeContentNode(node: Node): void {
    if (Supervisor.instance) {
      const index = Supervisor.instance.contentNodes.indexOf(node);
      if (index > -1) {
        Supervisor.instance.contentNodes.splice(index, 1);
      }
    }
  }

  public static clearContentNodes(): void {
    if (Supervisor.instance) {
      Supervisor.instance.contentNodes = [];
    }
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

      // Clean out dynamically injected editor components from the export
      const cleanEditorArtifacts = (data: any) => {
        if (!data) return;

        // Remove EditorInspectHandler from component bindings
        if (Array.isArray(data.component)) {
          data.component = data.component.filter((c: any) => c.reference !== "EditorInspectHandler");
          if (data.component.length === 0) delete data.component;
        }

        // Remove PreemptEditor nodes from content arrays
        if (Array.isArray(data.content)) {
          data.content = data.content.filter((n: any) => {
            return !(n.component && n.component.some((c: any) => c.reference === "PreemptEditor"));
          });
          if (data.content.length === 0) {
            delete data.content;
          } else {
            data.content.forEach((child: any) => cleanEditorArtifacts(child));
          }
        } else if (typeof data.content === 'object' && data.content !== null) {
          if (data.content.component && data.content.component.some((c: any) => c.reference === "PreemptEditor")) {
            delete data.content;
          } else {
            cleanEditorArtifacts(data.content);
          }
        }
      };

      cleanEditorArtifacts(exported);

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
      Node.globalMetadata = {};
    }
  }

  public static async process(templateData: NodeData, contentData: ContentPayload, config: PipelineConfig, serverApi?: any): Promise<string | void> {
    if (Supervisor.currentStage !== 'monitoring' && Supervisor.currentStage !== 'closed') {
      console.error(`Cannot start process: pipeline is currently in stage '${Supervisor.currentStage}'`);
      return;
    }

    if (Supervisor.instance) {
      Supervisor.instance.pauseMonitoring();
      if (contentData.userData) Supervisor.instance.userData = contentData.userData;
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      const result = await Supervisor.instance.runPipeline(templateData, contentData);
      Supervisor.instance.resumeMonitoring();
      return result;
    } else {
      Supervisor.instance = new Supervisor(config);
      if (contentData.userData) Supervisor.instance.userData = contentData.userData;
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      const result = await Supervisor.instance.runPipeline(templateData, contentData);
      if (!Supervisor.instance.config.runMonitoring) {
        Supervisor.instance.close();
      } else {
        Supervisor.instance.monitor();
      }
      return result;
    }
  }

  private async runPipeline(templateData: NodeData, contentData: ContentPayload): Promise<string | void> {
    if (this.config.runInstantiation && !this.hasInstantiated) {
      Supervisor.currentStage = 'instantiation';
      await this.instantiate(templateData, contentData);
      this.executeHandlers("afterInstantiate");
    }

    if (typeof window === 'undefined') {
      this.executeHandlers("onDBLoad");
    }

    if (this.config.runAssembly) {
      Supervisor.currentStage = 'assembly';
      this.executeHandlers("beforeAssembly");
      await this.assemble(contentData);
      this.executeHandlers("afterAssembly");
    }

    if (this.config.runPreprocessing) {
      Supervisor.currentStage = 'preprocessing';
      this.executeHandlers("beforePreprocess");
      await this.preProcess();
      this.executeHandlers("afterPreprocess");
    }

    if (this.config.runValidation) {
      Supervisor.currentStage = 'validation';
      this.executeHandlers("beforeValidate");
      await this.validate();
      this.executeHandlers("afterValidate");
    }

    let renderResult: string | void = undefined;
    if (this.config.runRendering) {
      Supervisor.currentStage = 'render';
      this.executeHandlers("beforeRender");
      renderResult = await this.render();
      this.executeHandlers("afterRender");
    }

    if (this.config.runPostprocessing) {
      Supervisor.currentStage = 'postprocessing';
      this.executeHandlers("beforePostprocess");
      await this.postProcess();
      this.executeHandlers("afterPostprocess");
    }

    return renderResult;
  }

  private async instantiate(templateData: NodeData, contentData: ContentPayload): Promise<void> {
    console.log("Stage: Instantiation");
    StyleNode.clear(); // Clear before re-running
    Node.clearPlacements();
    Node.nodeCounter = 0;
    Node.globalMetadata = contentData.metadata || {};

    const safeTemplateData = JSON.parse(JSON.stringify(templateData));
    const safeContentData = JSON.parse(JSON.stringify(contentData));
    this.rootNode = new Node(safeTemplateData);
    this.contentNodes = safeContentData.content.map((data: any) => new Node(data));
    this.hasInstantiated = true;
  }

  private async assemble(contentData: ContentPayload): Promise<void> {
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

  private async preProcess(): Promise<void> {
    console.log("Stage: Pre-processing");
  }

  private async validate(): Promise<void> {
    console.log("Stage: Validation");
    if (this.rootNode) {
      const isValid = this.rootNode.validate();
      if (!isValid) throw new Error("Validation failed");
    }
  }

  private async render(): Promise<string | void> {
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
          if (!mountTarget.contains(domElement)) {
            mountTarget.innerHTML = "";
            mountTarget.appendChild(domElement);
          }
        }
      }
    }
  }

  private async postProcess(): Promise<void> {
    console.log("Stage: Post-processing");
  }

  private executeHandlers(phase: string): void {
    if (this.rootNode) {
      this.rootNode.executeHandlers(phase, { supervisor: this });
    }

    this.contentNodes.forEach(node => {
      if (!this.rootNode || !this.rootNode.findNode(n => n === node)) {
        node.executeHandlers(phase, { supervisor: this });
      }
    });
  }

  private monitor(): void {
    Supervisor.currentStage = 'monitoring';
    this.executeHandlers("beforeMonitor");
    this.isMonitoring = true;
    console.log("Stage: Monitoring started, state:", this.isMonitoring);
  }

  private pauseMonitoring(): void {
    this.executeHandlers("onPause");
    this.isMonitoring = false;
    console.log("Monitoring paused, state:", this.isMonitoring);
  }

  private resumeMonitoring(): void {
    this.executeHandlers("onResume");
    this.isMonitoring = true;
    console.log("Monitoring resumed, state:", this.isMonitoring);
  }

  private close(): void {
    Supervisor.currentStage = 'closed';
    console.log("Supervisor closing. Pipeline complete.");
    Supervisor.instance = null;
    Node.globalMetadata = {};
  }
}
