import type { PipelineConfig } from "../types/Pipeline.js";
import type { NodeData, ContentPayload, UserData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { StyleNode } from "./StyleNode.js";
import { InstantiationWorker } from "./workers/InstantiationWorker.js";
import { PlacementWorker } from "./workers/PlacementWorker.js";
import { ComponentAssemblyWorker } from "./workers/ComponentAssemblyWorker.js";
import { SlotAssemblyWorker } from "./workers/SlotAssemblyWorker.js";
import { PreprocessingWorker } from "./workers/PreprocessingWorker.js";

import { ValidationWorker } from "./workers/ValidationWorker.js";
import { ClientRenderingWorker } from "./workers/ClientRenderingWorker.js";
import { SSRRenderingWorker } from "./workers/SSRRenderingWorker.js";
import { PostprocessingWorker } from "./workers/PostprocessingWorker.js";
import { clientAPI } from "./ClientAPI.js";

export class Supervisor {
  public static instance: Supervisor | null = null;
  public static currentStage: string = 'closed';

  public static propertyToPhaseMap: Record<string, number> = {
    'data': 0,
    'placement': 0,
    'activePlacement': 1,
    'component': 2,
    'content': 4,
    'children': 4,
    'handlers': 4,
    'versions': 4,
    'props': 5,
    'css': 5,
    'type': 5
  };

  public static isPropertyLocked(propertyName: string): boolean {
    const phaseId = Supervisor.propertyToPhaseMap[propertyName];
    if (phaseId === undefined || !Supervisor.instance) return false;
    return Supervisor.instance.activeLockedPhases.has(phaseId);
  }

  public instantiationWorker: InstantiationWorker;
  public placementWorker: PlacementWorker;
  public componentAssemblyWorker: ComponentAssemblyWorker;
  public slotAssemblyWorker: SlotAssemblyWorker;
  public preprocessingWorker: PreprocessingWorker;
  public validationWorker: ValidationWorker;
  public renderingWorker: any;
  public postprocessingWorker: PostprocessingWorker;

  public ssrResult?: string;

  public activeLockedPhases: Set<number> = new Set();

  public isPropertyLocked(propertyName: string): boolean {
    const phaseId = Supervisor.propertyToPhaseMap[propertyName];
    return phaseId !== undefined && this.activeLockedPhases.has(phaseId);
  }

  public config: PipelineConfig;
  public rootNode: Node | null = null;
  public contentNodes: Map<string | ContentPayload, Node[]> = new Map();
  private isMonitoring: boolean = false;
  private mountElementId: string;
  private hasInstantiated: boolean = false;
  public userData?: UserData;
  public serverApi?: any;
  public templateData: NodeData | null = null;
  public contentData: ContentPayload[] = [];

  private constructor(config: PipelineConfig, mountElementId: string = "app") {
    this.config = config;
    this.mountElementId = mountElementId;
    this.instantiationWorker = new InstantiationWorker(this);
    this.placementWorker = new PlacementWorker(this);
    this.componentAssemblyWorker = new ComponentAssemblyWorker(this);
    this.slotAssemblyWorker = new SlotAssemblyWorker(this);
    this.preprocessingWorker = new PreprocessingWorker(this);
    this.validationWorker = new ValidationWorker(this);

    if (typeof window === 'undefined' || (globalThis as any).process?.env?.IS_SSR_TEST === 'true') {
      this.renderingWorker = new SSRRenderingWorker(this);
    } else {
      this.renderingWorker = new ClientRenderingWorker(this);
    }

    this.postprocessingWorker = new PostprocessingWorker(this);
  }

  public getWorkerForPhase(phaseId: number): any {
    switch (phaseId) {
      case 0: return this.instantiationWorker;
      case 1: return this.placementWorker;
      case 2: return this.componentAssemblyWorker;
      case 3: return this.slotAssemblyWorker;
      case 4: return this.preprocessingWorker;
      case 5: return this.validationWorker;
      case 6: return this.renderingWorker;
      case 7: return this.postprocessingWorker;
      default: return undefined;
    }
  }

  public static emitToPhase(node: Node, rollbackState: any, phaseId: number): void {
    if (Supervisor.instance) {
      const worker = Supervisor.instance.getWorkerForPhase(phaseId);
      if (worker) {
        if (phaseId === 0 && typeof worker.pushRaw === 'function') {
          worker.pushRaw(node.data, node);
        } else {
          worker.push(node, rollbackState);
        }
      }
    }
  }

  public static getContentNodes(): Node[] {
    return Supervisor.instance ? Array.from(Supervisor.instance.contentNodes.values()).flat() : [];
  }

  public static getRootNode(): Node | null {
    return Supervisor.instance ? Supervisor.instance.rootNode : null;
  }


  // TODO: This method needs to be refactored to decouple editor-specific cleaning logic from the core Supervisor.
  public static exportRootNode(): NodeData | null {
    if (Supervisor.instance && Supervisor.instance.rootNode) {
      const exported = Supervisor.instance.rootNode.exportToJson();

      // TODO: Refactor editor artifact cleaning. This should be handled by a dedicated editor post-processor rather than hardcoded here.
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
    }
    Node.idCollisions.clear();
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
      if (templateData) Supervisor.instance.templateData = templateData;
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
      if (templateData) Supervisor.instance.templateData = templateData;
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
      if (Supervisor.instance) Supervisor.instance.activeLockedPhases.clear();
      return result;
    }
  }

  private static mergePayloads(existingData: ContentPayload[], newPayloads: ContentPayload[]): void {
    newPayloads.forEach(newPayload => {
      if (newPayload.metadata?.batchLabel) {
        const existingIndex = existingData.findIndex(p => p.metadata?.batchLabel === newPayload.metadata!.batchLabel);
        if (existingIndex > -1) {
          existingData[existingIndex] = newPayload;
        } else {
          existingData.push(newPayload);
        }
      } else {
        existingData.push(newPayload);
      }
    });
  }

  public static async injectContent(payload: ContentPayload | ContentPayload[]): Promise<void> {
    if (!Supervisor.instance) {
      let templateData;
      let existingContentData: ContentPayload[] = [];
      const data = clientAPI.getInitialData();
      if (data) {
        templateData = data.template;
        existingContentData = Array.isArray(data.content) ? data.content : (data.content ? [data.content] : []);
      }

      const payloads = Array.isArray(payload) ? payload : [payload];
      Supervisor.mergePayloads(existingContentData, payloads);

      await Supervisor.process({
        isValidationRun: false,
        runInstantiation: true,
        runAssembly: true,
        runPreprocessing: true,
        runValidation: true,
        runRendering: true,
        runPostprocessing: true,
        runMonitoring: true
      }, templateData, existingContentData);
      return;
    }

    const payloads = Array.isArray(payload) ? payload : [payload];

    // Safely copy userData if present
    const firstPayload = payloads[0];
    if (firstPayload?.userData) {
      Supervisor.instance.userData = firstPayload.userData;
    }

    // Merge into contentData
    if (!Supervisor.instance.contentData) {
      Supervisor.instance.contentData = [];
    }

    Supervisor.mergePayloads(Supervisor.instance.contentData, payloads);

    // We need to re-evaluate the components and content roots
    payloads.forEach(newPayload => {
      const key = newPayload.metadata?.batchLabel || newPayload;
      const existingNodes = Supervisor.instance!.contentNodes.get(key) || [];

      if (existingNodes.length > 0) {
        existingNodes.forEach(node => {
          PlacementWorker.restorePlacement(node);
        });
      }

      const nodesForPayload: Node[] = [];
      Supervisor.instance!.contentNodes.set(key, nodesForPayload);

      let contentArray: NodeData[] = [];
      if ((newPayload as any).type) contentArray = [newPayload as unknown as NodeData];
      else if (newPayload.content && Array.isArray(newPayload.content)) contentArray = newPayload.content;

      contentArray.forEach(data => {
        if (Supervisor.instance?.instantiationWorker && (Supervisor.instance.instantiationWorker as any).pushRaw) {
          (Supervisor.instance.instantiationWorker as any).pushRaw(data, null, (newNode: Node) => {
            nodesForPayload.push(newNode);
          });
        }
      });
    });

    if (Supervisor.currentStage === 'monitoring') {
      Supervisor.instance.pauseMonitoring();
      await Supervisor.instance.runPipeline();
      Supervisor.instance.resumeMonitoring();
      if (Supervisor.instance) Supervisor.instance.activeLockedPhases.clear();
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

    // Priority Queue Draining Loop
    let queueDrained = false;
    while (!queueDrained) {
      queueDrained = true;
      // Process in order 0 to 7
      for (let phaseId = 0; phaseId <= 7; phaseId++) {
        const worker = this.getWorkerForPhase(phaseId);
        if (worker && worker.hasEvents()) {
          Supervisor.currentStage = this.getStageNameForPhase(phaseId);
          await worker.processQueue();
          queueDrained = false;
          break; // Restart loop to prioritize lowest phase IDs again
        }
      }
    }

    if (this.ssrResult !== undefined) {
      const result = this.ssrResult;
      this.ssrResult = undefined;
      return result;
    }
  }

  private getStageNameForPhase(phaseId: number): string {
    switch (phaseId) {
      case 0: return 'instantiation';
      case 1: return 'placement';
      case 2: return 'componentAssembly';
      case 3: return 'slotAssembly';
      case 4: return 'preprocessing';
      case 5: return 'validation';
      case 6: return 'render';
      case 7: return 'postprocessing';
      default: return 'unknown';
    }
  }

  private async instantiate(): Promise<void> {
    await this.clearInternalState();
    console.log("Stage: Instantiation");

    // Generate initial nodes from data
    if (this.templateData || this.contentData.length > 0 || !this.rootNode) {
      const allComponents = this.contentData.flatMap(c => {
        const componentsFromPayload = c.component || [];
        const componentsFromContentRoots = (Array.isArray(c.content) ? c.content : [c.content]).flatMap((node: any) => {
          return (node?.component || []).filter((comp: any) => comp.value !== undefined && comp.value !== null);
        });
        return [...componentsFromPayload, ...componentsFromContentRoots];
      });
      const mountPointData: NodeData = {
        type: "div",
        props: { id: this.mountElementId },
        content: this.templateData ? [this.templateData] : undefined,
        component: allComponents.length > 0 ? allComponents : undefined,
      };
      if (this.instantiationWorker && (this.instantiationWorker as any).pushRaw) {
        (this.instantiationWorker as any).pushRaw(mountPointData, this.rootNode, (node: Node) => {
          this.rootNode = node;
        });
      }
    }

    this.contentNodes.clear();
    if (this.contentData && this.contentData.length > 0) {
      this.contentData.forEach(payload => {
        const key = payload.metadata?.batchLabel || payload;
        const nodesForPayload: Node[] = [];
        this.contentNodes.set(key, nodesForPayload);

        let allContentForPayload: NodeData[] = [];
        if ((payload as any).type) allContentForPayload = [payload as unknown as NodeData];
        else if (payload.content && Array.isArray(payload.content)) allContentForPayload = payload.content;

        allContentForPayload.forEach((data: any) => {
          if (this.instantiationWorker && (this.instantiationWorker as any).pushRaw) {
            (this.instantiationWorker as any).pushRaw(data, null, (node: Node) => {
              nodesForPayload.push(node);
            });
          }
        });
      });
    }


    await this.instantiationWorker.processQueue();
    this.hasInstantiated = true;
  }

  private async clearInternalState(): Promise<void> {
    StyleNode.clear();
    PlacementWorker.restoreAllPlacements();
    Node.globalMetadata = Object.assign({}, ...this.contentData.map(c => c.metadata || {}));
    const payloadWithUser = this.contentData.find(c => c.userData || c.metadata?.user);
    this.userData = payloadWithUser?.userData || payloadWithUser?.metadata?.user;
  }

  public executeHandlers(phase: string): void {
    if (this.config.isValidationRun) return;
    if (this.rootNode) {
      this.rootNode.executeHandlers(phase, { supervisor: this });
    }

    const contentNodesArr = Array.from(this.contentNodes.values()).flat();
    contentNodesArr.forEach(node => {
      if (node) {
        if (!this.rootNode || !this.rootNode.findNode((n: Node) => n === node)) {
          node.executeHandlers(phase, { supervisor: this });
        }
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
    if (Supervisor.instance) Supervisor.instance.activeLockedPhases.clear();
    Supervisor.instance = null;
    Node.globalMetadata = {};
  }
}

(globalThis as any).Supervisor = Supervisor;
