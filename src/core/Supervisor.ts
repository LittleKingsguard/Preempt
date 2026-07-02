import type { PipelineConfig } from "../types/Pipeline.js";
import type { NodeData, ContentPayload, UserData, NodeQuery } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { StyleNode } from "./StyleNode.js";

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
  private templateData: NodeData | null = null;
  private contentData: ContentPayload | null = null;

  private constructor(config: PipelineConfig, mountElementId: string = "app") {
    this.config = config;
    this.mountElementId = mountElementId;
  }

  public static getContentNodes(): Node[] {
    return Supervisor.instance ? Supervisor.instance.contentNodes : [];
  }

  public static getRootNode(): Node | null {
    return Supervisor.instance ? Supervisor.instance.rootNode : null;
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

  public static async process(config: PipelineConfig, templateData?: NodeData, contentData?: ContentPayload, serverApi?: any): Promise<string | void> {
    if (Supervisor.currentStage !== 'monitoring' && Supervisor.currentStage !== 'closed') {
      console.error(`Cannot start process: pipeline is currently in stage '${Supervisor.currentStage}'`);
      // Exit only if no contentData is provided *and* there is no existing contentData on the singleton
      if (!contentData && !Supervisor.instance?.contentData) {
        console.warn('process called without contentData and no existing instance content; exiting early.');
        return;
      }
      // If an instance already has contentData, continue processing
    }

    if (Supervisor.instance) {
      if (templateData && contentData) Supervisor.instance.templateData = templateData;
      if (contentData) Supervisor.instance.contentData = contentData;
      Supervisor.instance.pauseMonitoring();
      // Safely copy userData if present
      if (Supervisor.instance.contentData?.userData) {
        Supervisor.instance.userData = Supervisor.instance.contentData.userData;
      }
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      const result = await Supervisor.instance.runPipeline();
      Supervisor.instance.resumeMonitoring();
      return result;
    } else {
      Supervisor.instance = new Supervisor(config);
      if (templateData && contentData) Supervisor.instance.templateData = templateData;
      if (contentData) Supervisor.instance.contentData = contentData;
      // Safely copy userData if present
      if (Supervisor.instance.contentData?.userData) {
        Supervisor.instance.userData = Supervisor.instance.contentData.userData;
      }
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      const result = await Supervisor.instance.runPipeline();
      if (!Supervisor.instance.config.runMonitoring) {
        Supervisor.instance.close();
      } else {
        Supervisor.instance.monitor();
      }
      return result;
    }
  }

  private async runPipeline(): Promise<string | void> {
    console.log("DEBUG: pipeline stages", this.config.runInstantiation, !this.hasInstantiated);
    if (this.config.runInstantiation && !this.hasInstantiated) {
      Supervisor.currentStage = 'instantiation';
      await this.instantiate();
      this.executeHandlers("afterInstantiate");
    }

    if (typeof window === 'undefined') {
      this.executeHandlers("onDBLoad");
    }

    if (this.config.runAssembly) {
      Supervisor.currentStage = 'assembly';
      this.executeHandlers("beforeAssembly");
      await this.assemble();
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

  private async instantiate(): Promise<void> {
    console.log("Stage: Instantiation");
    StyleNode.clear(); // Clear before re-running
    Node.clearPlacements();
    Node.nodeCounter = 0;
    Node.globalMetadata = this.contentData?.metadata || {};
    this.userData = this.contentData?.userData || this.contentData?.metadata?.user;

    const safeTemplateData = JSON.parse(JSON.stringify(this.templateData));
    const safeContentData = JSON.parse(JSON.stringify(this.contentData));
    this.rootNode = new Node(safeTemplateData);

    if (safeContentData.type) {
      this.contentNodes = [new Node(safeContentData as any)];
    } else if (safeContentData.content && Array.isArray(safeContentData.content)) {
      this.contentNodes = safeContentData.content.map((data: any) => new Node(data));
    } else {
      this.contentNodes = [];
    }

    if (this.rootNode) {
      if (this.contentData?.component && this.contentData.component.length > 0) {
        if (!this.rootNode.data.component) {
          this.rootNode.data.component = [];
        }
        this.rootNode.data.component.push(...this.contentData.component);
      }
    }

    this.hasInstantiated = true;
  }

  private async assemble(): Promise<void> {
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
    if (this.config.isValidationRun) return;
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
  // fetch content from an external source and append to contentNodes with placements. Pass component to generate nodes from raw data.
  static async fetchContent({ url, batchLabel, query, defaultTemplate, placements }: { url: string, batchLabel: string, query: NodeQuery, defaultTemplate: NodeData, placements: string[] }) {
    const queryParams = new URLSearchParams(query as any).toString();
    const queryURL = queryParams ? `${url}?${queryParams}` : url;
    const response = await fetch(queryURL, { method: "GET" });
    const data = await response.json();
    let nodes = [];
    if (query.format === "content") {
      nodes = data.map((item: any) => new Node(item));
    }
    else {
      const templateJSON = JSON.stringify(defaultTemplate);
      nodes = data.map((item: any) => {
        // Create a plain object from the template
        const nodeObj: any = JSON.parse(templateJSON);
        if (!nodeObj.component) nodeObj.component = [];
        const parseToComponent = (itm: object | string) => {
          if (typeof itm === 'string') {
            nodeObj.component.push({ reference: 'data', value: itm });
          } else {
            Object.keys(itm).forEach((key) => {
              const existingComponent = nodeObj.component.find((c: any) => c.reference === key);
              if (existingComponent) {
                existingComponent.value = (itm as any)[key];
              } else {
                nodeObj.component.push({ reference: key, value: (itm as any)[key] });
              }
            });
          }
        };
        if (typeof item === 'object' && !Array.isArray(item)) {
          parseToComponent(item);
        } else if (Array.isArray(item)) {
          item.forEach((i: any) => parseToComponent(i));
        }
        // Return a proper Node instance
        return new Node(nodeObj);
      })
    }
    nodes.forEach((node: Node) => {
      if (!node.data.props) node.data.props = {};
      node.data.props.batchLabel = batchLabel;
      if (!node.data.placement) {
        node.data.placement = { targetPlacement: [] };
      }
      // Ensure targetPlacement array exists
      if (!node.data.placement.targetPlacement) {
        node.data.placement.targetPlacement = [];
      }
      node.data.placement.targetPlacement.push(...placements);
    });
    let currentContentNodes = this.getContentNodes();
    const oldNodes = currentContentNodes.filter((n) => n.data && n.data.props && n.data.props.batchLabel === batchLabel);
    oldNodes.forEach((node) => currentContentNodes.splice(currentContentNodes.indexOf(node), 1));
    currentContentNodes.push(...nodes);
    Supervisor.process({
      runInstantiation: false,
      runAssembly: true,
      runPreprocessing: true,
      runValidation: true,
      runRendering: true,
      runPostprocessing: true,
      runMonitoring: true
    });
  }
}
