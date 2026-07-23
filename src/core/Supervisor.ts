import type { PipelineConfig } from "../types/Pipeline.js";
import type { NodeData, ContentPayload, UserData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { Template } from "./Template.js";
import { Payload } from "./Payload.js";
import { StyleNode } from "./StyleNode.js";
import { InstantiationWorker } from "./workers/InstantiationWorker.js";
import { PlacementWorker } from "./workers/PlacementWorker.js";
import { ComponentAssemblyWorker } from "./workers/ComponentAssemblyWorker.js";
import { SlotAssemblyWorker } from "./workers/SlotAssemblyWorker.js";
import { PreprocessingWorker } from "./workers/PreprocessingWorker.js";

import { ValidationWorker } from "./workers/ValidationWorker.js";
import { ClientElementCreationWorker } from "./workers/ClientElementCreationWorker.js";
import { ClientTreeAssemblyWorker } from "./workers/ClientTreeAssemblyWorker.js";
import { SSRElementCreationWorker } from "./workers/SSRElementCreationWorker.js";
import { SSRTreeAssemblyWorker } from "./workers/SSRTreeAssemblyWorker.js";
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
  public elementCreationWorker: any;
  public treeAssemblyWorker: any;
  public renderingWorker: any;
  public postprocessingWorker: PostprocessingWorker;

  public ssrResult?: string | undefined;

  public activeLockedPhases: Set<number> = new Set();

  public isPropertyLocked(propertyName: string): boolean {
    const phaseId = Supervisor.propertyToPhaseMap[propertyName];
    return phaseId !== undefined && this.activeLockedPhases.has(phaseId);
  }

  public config: PipelineConfig;
  public get rootNode(): Node | null {
    return this.templateData ? this.templateData.root : null;
  }
  public contentNodes: Map<string | ContentPayload | Template, Node[]> = new Map();
  private isMonitoring: boolean = false;
  public mountElementId: string;
  private hasInstantiated: boolean = false;
  public userData?: UserData;
  public serverApi?: any;
  public templateData!: Template;
  public contentData: ContentPayload[] = [];

  private constructor(config: PipelineConfig, templateData: Template, mountElementId: string = "app") {
    this.config = config;
    this.mountElementId = mountElementId;
    this.templateData = templateData;
    Supervisor.instance = this;
    this.instantiationWorker = new InstantiationWorker(this);
    this.placementWorker = new PlacementWorker(this);
    this.componentAssemblyWorker = new ComponentAssemblyWorker(this);
    this.slotAssemblyWorker = new SlotAssemblyWorker(this);
    this.preprocessingWorker = new PreprocessingWorker(this);
    this.validationWorker = new ValidationWorker(this);

    if (typeof window === 'undefined' || (globalThis as any).process?.env?.IS_SSR_TEST === 'true') {
      this.elementCreationWorker = new SSRElementCreationWorker(this);
      this.treeAssemblyWorker = new SSRTreeAssemblyWorker(this);
    } else {
      this.elementCreationWorker = new ClientElementCreationWorker(this);
      this.treeAssemblyWorker = new ClientTreeAssemblyWorker(this);
    }
    this.renderingWorker = this.elementCreationWorker;

    this.postprocessingWorker = new PostprocessingWorker(this);
    Supervisor.flushPendingEmits();
  }

  public getWorkerForPhase(phaseId: number): any {
    switch (phaseId) {
      case 0: return this.instantiationWorker;
      case 1: return this.placementWorker;
      case 2: return this.componentAssemblyWorker;
      case 3: return this.slotAssemblyWorker;
      case 4: return this.preprocessingWorker;
      case 5: return this.validationWorker;
      case 6: return this.elementCreationWorker;
      case 7: return this.treeAssemblyWorker;
      case 8: return this.postprocessingWorker;
      default: return undefined;
    }
  }

  public static activeLockedPhases: Set<number> = new Set<number>();
  public static pendingEmits: { caller: any; node: Node; rollbackState: any; phaseId: number }[] = [];

  public static lockPhase(phaseId: number): void {
    if (phaseId === 2) {
      // Component assembly locks on slot completion (Phase 3 completion)
      return;
    }
    Supervisor.activeLockedPhases.add(phaseId);
    if (phaseId === 3) {
      // Slot assembly completion also locks component assembly (Phase 2)
      Supervisor.activeLockedPhases.add(2);
    }
  }

  public static isPhaseLocked(phaseId: number): boolean {
    return Supervisor.activeLockedPhases.has(phaseId);
  }

  public static emitToPhase(caller: any, node: Node, rollbackState: any, phaseId: number): void {
    console.log(`[Supervisor.emitToPhase] Phase ${phaseId} emitted for node ${node.css?.id || 'unknown'} by:`, caller);
    if (Supervisor.instance) {
      if (!Supervisor.isPhaseLocked(phaseId)) {
        const worker = Supervisor.instance.getWorkerForPhase(phaseId);
        if (worker && typeof worker.push === 'function') {
          worker.push(node, rollbackState);
        }
      }
    } else {
      Supervisor.pendingEmits.push({ caller, node, rollbackState, phaseId });
    }
  }

  public static flushPendingEmits(): void {
    if (!Supervisor.instance) return;
    const emits = [...Supervisor.pendingEmits];
    Supervisor.pendingEmits = [];
    for (const emit of emits) {
      Supervisor.emitToPhase(emit.caller, emit.node, emit.rollbackState, emit.phaseId);
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
      return Supervisor.instance.rootNode.exportToJson();
    }
    return null;
  }

  public static resetInstantiation(): void {
    if (Supervisor.instance) {
      Supervisor.instance.hasInstantiated = false;
    }
    Supervisor.pendingEmits = [];
    Node.idCollisions.clear();
  }

  public static async process(config: PipelineConfig, templateData: Template, contentData?: ContentPayload | ContentPayload[], serverApi?: any): Promise<string | void> {
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
      Supervisor.instance.templateData = templateData;
      if (contentData) Supervisor.instance.contentData = Array.isArray(contentData) ? contentData : [contentData];
      Supervisor.instance.pauseMonitoring();
      // Safely copy userData if present
      const firstPayload = Supervisor.instance.contentData?.[0];
      if (firstPayload?.userData) {
        Supervisor.instance.userData = firstPayload.userData;
      }
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      Supervisor.instance.templateData.root.css.id = Supervisor.instance.mountElementId;
      Supervisor.instance.templateData.root.props.id = Supervisor.instance.mountElementId;
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        Supervisor.instance.templateData.root.element = document.getElementById(Supervisor.instance.mountElementId);
      }
      const result = await Supervisor.instance.runPipeline();
      Supervisor.instance.resumeMonitoring();
      return result;
    } else {
      Supervisor.instance = new Supervisor(config, templateData);
      if (contentData) Supervisor.instance.contentData = Array.isArray(contentData) ? contentData : [contentData];
      // Safely copy userData if present
      const firstPayload = Supervisor.instance.contentData?.[0];
      if (firstPayload?.userData) {
        Supervisor.instance.userData = firstPayload.userData;
      }
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      Supervisor.instance.templateData.root.css.id = Supervisor.instance.mountElementId;
      Supervisor.instance.templateData.root.props.id = Supervisor.instance.mountElementId;
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        Supervisor.instance.templateData.root.element = document.getElementById(Supervisor.instance.mountElementId);
      }
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

  public static clearLockedPhases(): void {
    if (Supervisor.instance) {
      Supervisor.instance.activeLockedPhases.clear();
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

    Supervisor.clearLockedPhases();

    // Re-evaluate content nodes using Payload class
    payloads.forEach(newPayload => {
      const key = newPayload.metadata?.batchLabel || newPayload;
      const existingNodes = Supervisor.instance!.contentNodes.get(key) || [];

      if (existingNodes.length > 0) {
        existingNodes.forEach(node => {
          node.clearTrackingArrays();
        });
      }

      const payloadObj = newPayload instanceof Payload ? newPayload : new Payload(newPayload);
      const contentNodes = payloadObj.assembleContentNodes();
      Supervisor.instance!.contentNodes.set(key, contentNodes);
    });

    if (Supervisor.currentStage === 'monitoring') {
      Supervisor.instance.pauseMonitoring();
      await Supervisor.instance.runPipeline();
      Supervisor.instance.resumeMonitoring();
      Supervisor.clearLockedPhases();
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
      await Supervisor.instance.clearInternalState();
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

  public async runPipeline(): Promise<string | void> {
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
          Supervisor.lockPhase(phaseId);
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
      case 6: return 'elementCreation';
      case 7: return 'treeAssembly';
      case 8: return 'postprocessing';
      default: return 'unknown';
    }
  }

  private async instantiate(): Promise<void> {
    console.log("Stage: Instantiation");

    // Generate initial nodes from data via Template & Payload
    this.contentNodes.clear();

    if (this.templateData.children && this.templateData.children.length > 0) {
      this.contentNodes.set(this.templateData, [...this.templateData.children]);
    }

    if (this.contentData && this.contentData.length > 0) {
      this.contentData.forEach(payload => {
        const key = payload.metadata?.batchLabel || payload;
        const payloadObj = payload instanceof Payload ? payload : new Payload(payload);
        const nodesForPayload = payloadObj.assembleContentNodes();
        this.contentNodes.set(key, nodesForPayload);
      });
    }

    this.hasInstantiated = true;
  }

  private async clearInternalState(): Promise<void> {
    StyleNode.clear();
    PlacementWorker.restoreAllPlacements();
    Node.globalMetadata = Object.assign({}, ...this.contentData.map(c => c.metadata || {}));
    const payloadWithUser = this.contentData.find(c => c.userData || c.metadata?.user);
    this.userData = payloadWithUser?.userData || payloadWithUser?.metadata?.user;
  }
  //TODO: Shift backend responsibilities of this to SSR functions and delete this method.
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
