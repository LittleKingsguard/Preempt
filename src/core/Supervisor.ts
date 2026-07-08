import type { PipelineConfig } from "../types/Pipeline.js";
import type { NodeData, ContentPayload, UserData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { StyleNode } from "./StyleNode.js";

export class Supervisor {
  public static instance: Supervisor | null = null;
  private config: PipelineConfig;
  private rootNode: Node | null = null;
  private contentNodes: Node[] = [];
  private isMonitoring: boolean = false;
  private mountElementId: string;
  private hasInstantiated: boolean = false;
  public userData?: UserData;
  public serverApi?: any;
  public static currentStage: string = 'closed';
  public templateData: NodeData | null = null;
  public contentData: ContentPayload[] = [];

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

  public static async process(config: PipelineConfig, templateData?: NodeData, contentData?: ContentPayload | ContentPayload[], serverApi?: any): Promise<string | void> {
    if (Supervisor.currentStage !== 'monitoring' && Supervisor.currentStage !== 'closed') {
      console.error(`Cannot start process: pipeline is currently in stage '${Supervisor.currentStage}'`);
      // Exit only if no contentData is provided *and* there is no existing contentData on the singleton
      if (!contentData && (!Supervisor.instance?.contentData || Supervisor.instance.contentData.length === 0)) {
        console.warn('process called without contentData and no existing instance content; exiting early.');
        return;
      }
      // If an instance already has contentData, continue processing
    }

    if (Supervisor.instance) {
      if (templateData && contentData) Supervisor.instance.templateData = templateData;
      if (contentData) Supervisor.instance.contentData = Array.isArray(contentData) ? contentData : [contentData];
      Supervisor.instance.pauseMonitoring();
      // Safely copy userData if present
      const firstPayload = Supervisor.instance.contentData?.[0];
      if (firstPayload?.userData) {
        Supervisor.instance.userData = firstPayload.userData;
      }
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      const result = await Supervisor.instance.runPipeline();
      Supervisor.instance.resumeMonitoring();
      return result;
    } else {
      Supervisor.instance = new Supervisor(config);
      if (templateData && contentData) Supervisor.instance.templateData = templateData;
      if (contentData) Supervisor.instance.contentData = Array.isArray(contentData) ? contentData : [contentData];
      // Safely copy userData if present
      const firstPayload = Supervisor.instance.contentData?.[0];
      if (firstPayload?.userData) {
        Supervisor.instance.userData = firstPayload.userData;
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

  public static async rerun(configOverride?: Partial<PipelineConfig>): Promise<string | void> {
    if (!Supervisor.instance) {
      console.error("Cannot rerun: no active Supervisor instance exists.");
      return;
    }

    const rerunConfig: PipelineConfig = {
      runInstantiation: true,
      runAssembly: true,
      runPreprocessing: true,
      runValidation: true,
      runRendering: true,
      runPostprocessing: true,
      runMonitoring: true,
      ...configOverride
    };

    const originalConfig = Supervisor.instance.config;
    Supervisor.instance.config = rerunConfig;

    if (rerunConfig.runInstantiation) {
      Supervisor.resetInstantiation();
    }

    Supervisor.instance.pauseMonitoring();
    const result = await Supervisor.instance.runPipeline();

    Supervisor.instance.config = originalConfig;
    if (originalConfig.runMonitoring) {
      Supervisor.instance.resumeMonitoring();
    } else {
      Supervisor.instance.close();
    }

    return result;
  }

  private async runPipeline(): Promise<string | void> {
    if (this.config.runInstantiation && !this.hasInstantiated) {
      Supervisor.currentStage = 'instantiation';
      await this.instantiate();
      this.executeHandlers("afterInstantiate");
    }

    if (typeof window === 'undefined' || (globalThis as any).process?.env?.IS_SSR_TEST === 'true') {
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

    Node.globalMetadata = Object.assign({}, ...this.contentData.map(c => c.metadata || {}));
    
    const payloadWithUser = this.contentData.find(c => c.userData || c.metadata?.user);
    this.userData = payloadWithUser?.userData || payloadWithUser?.metadata?.user;

    const deepClone = (val: any) => {
      if (val === undefined) return undefined;
      const seen = new WeakSet();
      const replacer = (k: string, v: any) => {
        if (k === 'node' || k === '_instantiatedNodes' || k === '_referencingNodes' || k === 'parent' || k === 'children' || k === 'originalParent') return undefined;
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return undefined; // Prevent cycle
          seen.add(v);
        }
        return v;
      };
      try {
        return JSON.parse(JSON.stringify(val, replacer));
      } catch (e) {
        console.warn("Cycle detected during deepClone in Supervisor, falling back", e);
        return val;
      }
    };

    const regenerateTree = (existingNode: Node | null, data: any): Node => {
      let newNode: Node;
      if (!existingNode) {
        newNode = new Node(deepClone(data));
      } else if (existingNode.hasChangedSinceRender) {
        newNode = new Node(existingNode.data);
      } else {
        const newChildren = [];
        for (let i = 0; i < existingNode.children.length; i++) {
          const child = existingNode.children[i];
          if (child && !child.isComponentInjected) {
            const newChild = regenerateTree(child, child.data);
            newChild.parent = existingNode;
            newChildren.push(newChild);
          }
        }
        existingNode.children = newChildren;
        newNode = existingNode;
      }
      
      if (newNode.component?.some(c => c.target === "type")) {
        Node.typeComponentNodes.push(newNode);
      }
      
      return newNode;
    };

    const safeTemplateData = deepClone(this.templateData);
    const allComponents = this.contentData.flatMap(c => c.component || []);
    if (allComponents.length > 0) {
      if (!safeTemplateData.component) safeTemplateData.component = [];
      safeTemplateData.component.push(...deepClone(allComponents));
    }

    this.rootNode = regenerateTree(this.rootNode, safeTemplateData);

    const allContent = this.contentData.flatMap(payload => {
      if ((payload as any).type) return [payload as unknown as NodeData];
      if (payload.content && Array.isArray(payload.content)) return payload.content;
      return [];
    });

    if (allContent.length > 0) {
      const safeContentList = deepClone(allContent);
      this.contentNodes = safeContentList.map((data: any, idx: number) => {
        return regenerateTree(this.contentNodes[idx] || null, data);
      });
    } else {
      this.contentNodes = [];
    }

    this.hasInstantiated = true;
  }

  private async assemble(): Promise<void> {
    console.log("Stage: Assembly");
    console.log("[DEBUG] Content nodes array at start of placement process:", this.contentNodes.map(n => ({ type: n.type, id: n.css?.id, targetPlacement: n.placement?.targetPlacement })));
    // Collect placement nodes from the entire node tree before processing placements
    const collectPlacements = (node: Node) => {
      Node.appendPlacement(node);
      if (Array.isArray(node.data.content)) {
        node.data.content.forEach((childData: any) => {
          if (childData.node) collectPlacements(childData.node);
        });
      } else if (typeof node.data.content === "object" && node.data.content !== null) {
        if ((node.data.content as any).node) {
          collectPlacements((node.data.content as any).node);
        }
      }
      if (node.component) {
        node.component.forEach(binding => {
          if (binding._instantiatedNodes) {
            binding._instantiatedNodes.forEach((child: Node) => collectPlacements(child));
          }
        });
      }
    };
    if (this.rootNode) {
      collectPlacements(this.rootNode);
    }
    this.contentNodes.forEach(node => {
      collectPlacements(node);
    });

    console.log("[DEBUG] Source placements after parsing nodes:", Node.sourcePlacements.map(n => ({ type: n.type, id: n.css?.id, targetPlacement: n.placement?.targetPlacement })));

    for (const sourceNode of Node.sourcePlacements) {
      const targets = sourceNode.placement?.targetPlacement || [];
      let matchedTarget: Node | null = null;
      for (const targetName of targets) {
        matchedTarget = Node.placementArray.find(n => n.placement?.placementName === targetName) || null;
        if (matchedTarget) break;
      }

      if (matchedTarget) {
        sourceNode.placeInto(matchedTarget);
      } else {
        console.warn(`[DEBUG] Failed to find target placement for node type '${sourceNode.type}' with id '${sourceNode.css?.id}'. Looked for targets:`, targets);
      }
    }

    
    if (this.rootNode) {
      this.rootNode.applyComponentsTree();
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

    if (typeof window === 'undefined' || (globalThis as any).process?.env?.IS_SSR_TEST === 'true') {
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
    Supervisor.currentStage = 'monitoring';
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
