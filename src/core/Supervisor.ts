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

/**
 * Central pipeline orchestrator singleton managing the 9-stage worker pipeline in Preempt.
 *
 * @useCase Primary engine executing SSR HTML generation or driving client-side reactive virtual DOM updates.
 * @processFlow Instantiated on process start or HTTP request, coordinates workers (Phases 0-8), handles phase locks, and runs the monitoring loop.
 */
export class Supervisor {
  /** Active Supervisor singleton instance. Access via `Supervisor.instance`. */
  public static instance: Supervisor | null = null;
  /** Current pipeline execution stage name (e.g. 'instantiation', 'monitoring', 'closed'). */
  public static currentStage: string = 'closed';

  /** Mapping of Node schema property names to their corresponding phase lock ID numbers. */
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

  /**
   * Checks whether a specific Node property is locked against mutation during the current stage.
   *
   * @param propertyName Target property key (e.g. 'css', 'props', 'children').
   * @returns `true` if property is currently locked, `false` otherwise.
   * @references `Node.receiveNextState()`, `Node.mergeNativeChildren()`, `Supervisor.isPropertyLocked()`
   */
  public static isPropertyLocked(propertyName: string): boolean {
    const phaseId = Supervisor.propertyToPhaseMap[propertyName];
    if (phaseId === undefined) return false;
    return Supervisor.isPhaseLocked(phaseId);
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

  /** Final HTML/CSS string generated during Server-Side Rendering (SSR). */
  public ssrResult?: string | undefined;

  /**
   * Checks whether a property name is locked.
   *
   * @param propertyName Target property name.
   * @returns `true` if locked, `false` otherwise.
   * @references Called on instance to check property lock state against current Supervisor phase.
   */
  public isPropertyLocked(propertyName: string): boolean {
    return Supervisor.isPropertyLocked(propertyName);
  }

  public config: PipelineConfig;
  public get rootNode(): Node | null {
    return this.templateData ? this.templateData.root : null;
  }
  public get contentNodes(): Map<Payload | Template, Node[]> {
    const map = new Map<Payload | Template, Node[]>();
    if (this.templateData && this.templateData.children && this.templateData.children.length > 0) {
      map.set(this.templateData, [...this.templateData.children]);
    }
    if (this.contentData && this.contentData.size > 0) {
      this.contentData.forEach(payloadObj => {
        map.set(payloadObj, [...payloadObj.content]);
      });
    }
    return map;
  }
  private isMonitoring: boolean = false;
  public mountElementId: string;
  private hasInstantiated: boolean = false;
  public userData?: UserData;
  public serverApi?: any;
  public templateData!: Template;
  public contentData: Set<Payload> = new Set();

  /**
   * Private constructor for Supervisor instance.
   *
   * @param config PipelineConfig flags.
   * @param templateData Root Template instance.
   * @param mountElementId DOM mount container element ID (defaults to "app").
   * @references `Supervisor.process()`
   */
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

  /**
   * Retrieves the worker instance responsible for a given phase ID number.
   *
   * @param phaseId Phase ID (0-8).
   * @returns Worker instance or undefined.
   * @references `Supervisor.emitToPhase()`, `Supervisor.runPipeline()`
   */
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

  /** Active locked phase IDs set. */
  public static activeLockedPhases: Set<number> = new Set<number>();
  /** Queue of pending emissions submitted prior to Supervisor singleton instantiation. */
  public static pendingEmits: { caller: any; node: Node; rollbackState: any; phaseId: number }[] = [];
  public static isPipelineScheduled: boolean = false;
  public static isPipelineRunning: boolean = false;
  public static pipelinePromise: Promise<string | void> | null = null;

  /**
   * Schedules a microtask pipeline execution batch.
   *
   * @returns Promise resolving when scheduled pipeline execution completes.
   * @useCase Microtask batching of pipeline updates.
   * @processFlow Event loop microtask scheduling.
   * @references `Supervisor.emitToPhase()`, `Supervisor.injectContent()`
   */
  public static schedulePipeline(): Promise<string | void> {
    if (Supervisor.pipelinePromise) {
      return Supervisor.pipelinePromise;
    }

    Supervisor.isPipelineScheduled = true;
    const scheduleMicrotask = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (cb: () => void) => Promise.resolve().then(cb);

    Supervisor.pipelinePromise = new Promise<string | void>((resolve, reject) => {
      scheduleMicrotask(async () => {
        Supervisor.isPipelineScheduled = false;
        try {
          if (!Supervisor.instance) {
            resolve();
            return;
          }
          let result: string | void = undefined;
          if (Supervisor.currentStage === 'monitoring') {
            Supervisor.instance.pauseMonitoring();
            result = await Supervisor.instance.runPipeline();
            Supervisor.instance.resumeMonitoring();
            Supervisor.clearLockedPhases();
          } else if (Supervisor.currentStage !== 'closed') {
            result = await Supervisor.instance.runPipeline();
          }
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          Supervisor.pipelinePromise = null;
        }
      });
    });

    return Supervisor.pipelinePromise;
  }

  /**
   * Locks a specific pipeline phase ID from receiving new node emissions.
   *
   * @param phaseId Phase ID (0-8) to lock.
   * @references `Supervisor.runPipeline()`
   */
  public static lockPhase(phaseId: number): void {
    if (phaseId === 2) {
      // Phase 2 locks when Phase 3 locks
      return;
    }
    Supervisor.activeLockedPhases.add(phaseId);
    if (phaseId === 3) {
      // Phase 3 locking also locks Phase 2
      Supervisor.activeLockedPhases.add(2);
    }
  }

  /**
   * Checks whether a specific phase ID is currently locked.
   *
   * @param phaseId Phase ID to test.
   * @returns `true` if phase is locked, `false` otherwise.
   * @references `Supervisor.isPropertyLocked()`, `Supervisor.emitToPhase()`, `Node.receiveNextState()`
   */
  public static isPhaseLocked(phaseId: number): boolean {
    return Supervisor.activeLockedPhases.has(phaseId);
  }

  /**
   * Emits a Node instance to a target worker phase for stage processing.
   *
   * @param caller Originating method or object emitting the event.
   * @param node Target Virtual DOM Node instance.
   * @param rollbackState State snapshot for rollback recovery.
   * @param phaseId Destination worker phase ID (0-8).
   * @useCase Pushing node events to worker processing queues.
   * @processFlow Phase event queueing and pipeline scheduling.
   * @references `BaseWorker.onProcessSuccess()`, `ClientElementCreationWorker.onProcessSuccess()`, `SSRElementCreationWorker.onProcessSuccess()`, `ValidationWorker.onProcessSuccess()`, `Node.constructor`, `Node.receiveNextState()`, `Placement.placeInto()`, `Component.resolveBinding()`
   */
  public static emitToPhase(caller: any, node: Node, rollbackState: any, phaseId: number): void {
    if (Supervisor.instance) {
      if (!Supervisor.isPhaseLocked(phaseId)) {
        const worker = Supervisor.instance.getWorkerForPhase(phaseId);
        if (worker && typeof worker.push === 'function') {
          worker.push(node, rollbackState);
          console.log(`[Supervisor.emitToPhase] Phase ${phaseId} emitted for node ${node.css?.id || 'unknown'} by:`, caller);
          Supervisor.schedulePipeline();
        }
      } else {
        console.warn(`[Supervisor.emitToPhase] Failed attempt to emit to Phase ${phaseId} for node ${node.css?.id || 'unknown'} by:`, caller, `(Phase ${phaseId} is locked)`);
      }
    } else {
      Supervisor.pendingEmits.push({ caller, node, rollbackState, phaseId });
    }
  }

  /**
   * Flushes all pending emissions collected before Supervisor initialization.
   *
   * @useCase Processes events pushed to `Supervisor.pendingEmits` during early node construction prior to `Supervisor` initialization.
   * @processFlow Invoked automatically by `Supervisor` constructor. Copies pending event snapshots, resets `Supervisor.pendingEmits`, and routes each pending node to `Supervisor.emitToPhase()`.
   * @references `Supervisor.constructor`
   */
  public static flushPendingEmits(): void {
    if (!Supervisor.instance) return;
    const emits = [...Supervisor.pendingEmits];
    Supervisor.pendingEmits = [];
    for (const emit of emits) {
      Supervisor.emitToPhase(emit.caller, emit.node, emit.rollbackState, emit.phaseId);
    }
  }

  /**
   * Helper returning all active content Node instances across all loaded payloads.
   *
   * @returns Flat array of all content Node instances.
   * @references Public API helper accessible to custom Handlers & Client API.
   */
  public static getContentNodes(): Node[] {
    return Supervisor.instance ? Array.from(Supervisor.instance.contentNodes.values()).flat() : [];
  }

  /**
   * Helper returning the root Node instance of the template layout tree.
   *
   * @returns Root Node instance or null.
   * @references `ClientElementCreationWorker.createElement()`, `SSRElementCreationWorker.renderNodeElementToString()`, `Node.executeHandlers()`, `ClientAPI.modifyNode()`, `WebSocketClient.subscribe()`
   */
  public static getRootNode(): Node | null {
    return Supervisor.instance ? Supervisor.instance.rootNode : null;
  }

  /**
   * Exports the root Node tree as a clean `NodeData` JSON object.
   *
   * @returns Clean NodeData JSON structure or null.
   * @references `ClientAPI.modifyNode()`, `main.ts.init()`, integration and E2E test suites
   */
  public static exportRootNode(): NodeData | null {
    // TODO: This method needs to be refactored to decouple editor-specific cleaning logic from the core Supervisor.
    if (Supervisor.instance && Supervisor.instance.rootNode) {
      return Supervisor.instance.rootNode.exportToJson();
    }
    return null;
  }

  /**
   * Resets instantiation state flags, active pipeline promises, and ID collision tracking maps.
   *
   * @references `Supervisor.rerun()`, unit and integration test suites
   */
  public static resetInstantiation(): void {
    if (Supervisor.instance) {
      Supervisor.instance.hasInstantiated = false;
    }
    Supervisor.isPipelineScheduled = false;
    Supervisor.isPipelineRunning = false;
    Supervisor.pipelinePromise = null;
    Supervisor.pendingEmits = [];
    Node.idCollisions.clear();
  }

  /**
   * Primary entry point for executing the Supervisor pipeline with given configuration, template, and content data.
   *
   * @param config PipelineConfig execution flags.
   * @param templateData Root Template layout structure.
   * @param contentData Page content payload(s).
   * @param serverApi Optional server API reference (SSR).
   * @returns Promise resolving to SSR HTML string output (on server) or void (on client).
   * @useCase Invoked by `ssr.ts` on server or `main.ts` on client to start rendering.
   * @processFlow Initializes Supervisor instance, executes pipeline workers (Phases 0-8), starts client monitoring loop.
   * @references `main.ts.init()`, `server/src/routes/ssr.ts`, `ClientAPI.injectContent()`, integration and E2E test suites
   */
  public static async process(config: PipelineConfig, templateData: Template, contentData?: ContentPayload | ContentPayload[], serverApi?: any): Promise<string | void> {

    if (Supervisor.currentStage !== 'monitoring' && Supervisor.currentStage !== 'closed') {
      console.error(`Cannot start process: pipeline is currently in stage '${Supervisor.currentStage}'`);
      if (!templateData && (!Supervisor.instance || !Supervisor.instance.templateData)) {
        console.warn('process called without templateData and no existing instance template; exiting early.');
        return;
      }
      // If an instance already has contentData, continue processing
    }

    if (Supervisor.instance) {
      Supervisor.instance.templateData = templateData;
      if (contentData) {
        const payloads = Array.isArray(contentData) ? contentData : [contentData];
        Supervisor.instance.contentData = new Set(payloads.map(p => new Payload(p)));
      }
      Supervisor.instance.pauseMonitoring();
      // Safely copy userData if present
      const firstPayload = Array.from(Supervisor.instance.contentData)[0];
      if (firstPayload?.userData) {
        Supervisor.instance.userData = firstPayload.userData;
      }
      if (Supervisor.instance.templateData?.root) {
        const rootNode = Supervisor.instance.templateData.root as any;
        if (!rootNode.css) rootNode.css = {};
        rootNode.css.id = Supervisor.instance.mountElementId;
        if (!rootNode.props) rootNode.props = {};
        rootNode.props.id = Supervisor.instance.mountElementId;
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          rootNode.element = document.getElementById(Supervisor.instance.mountElementId);
        }
      }
      const result = await Supervisor.instance.runPipeline();
      Supervisor.instance.resumeMonitoring();
      return result;
    } else {
      Supervisor.instance = new Supervisor(config, templateData);
      if (contentData) {
        const payloads = Array.isArray(contentData) ? contentData : [contentData];
        Supervisor.instance.contentData = new Set(payloads.map(p => new Payload(p)));
      }
      // Safely copy userData if present
      const firstPayload = Array.from(Supervisor.instance.contentData)[0];
      if (firstPayload?.userData) {
        Supervisor.instance.userData = firstPayload.userData;
      }
      if (serverApi) Supervisor.instance.serverApi = serverApi;
      if (Supervisor.instance.templateData?.root) {
        const rootNode = Supervisor.instance.templateData.root as any;
        if (!rootNode.css) rootNode.css = {};
        rootNode.css.id = Supervisor.instance.mountElementId;
        if (!rootNode.props) rootNode.props = {};
        rootNode.props.id = Supervisor.instance.mountElementId;
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          rootNode.element = document.getElementById(Supervisor.instance.mountElementId);
        }
      }
      const result = await Supervisor.instance.runPipeline();
      if (!Supervisor.instance.config.runMonitoring) {
        Supervisor.instance.close();
      } else {
        Supervisor.instance.monitor();
      }
      Supervisor.activeLockedPhases.clear();
      return result;
    }
  }

  /**
   * Clears all active phase locks across the pipeline.
   *
   * @references `Supervisor.schedulePipeline()`, `Supervisor.process()`, `Supervisor.injectContent()`, `Supervisor.monitor()`, `Supervisor.resumeMonitoring()`
   */
  public static clearLockedPhases(): void {
    Supervisor.activeLockedPhases.clear();
  }

  /**
   * Helper function merging incoming content payloads into an existing `Payload` set, deduplicating matching batch labels.
   *
   * @param existingData Active set of `Payload` objects to update.
   * @param newPayloads Array of incoming raw `ContentPayload` objects to merge.
   * @useCase Deduplicating dynamic page content payloads when dynamic content is injected via `injectContent`.
   * @processFlow Iterates over incoming raw payloads, matches existing entries by `batchLabel`, removes matched stale payloads, and adds new payloads.
   * @references `Supervisor.injectContent()`
   */
  private static mergePayloads(existingData: Set<Payload>, newPayloads: ContentPayload[]): void {
    newPayloads.forEach(rawPayload => {
      const newPayload = new Payload(rawPayload);
      if (newPayload.metadata?.batchLabel) {
        let matched: Payload | null = null;
        for (const p of existingData) {
          if (p.metadata?.batchLabel === newPayload.metadata.batchLabel) {
            matched = p;
            break;
          }
        }
        if (matched) {
          existingData.delete(matched);
        }
      }
      existingData.add(newPayload);
    });
  }

  /**
   * Merges new content payload(s) into the active content data set and schedules a pipeline update.
   *
   * @param payload Single ContentPayload or array of ContentPayload objects.
   * @useCase Invoked via `ClientAPI.fetchContent()` or handler data fetches to inject dynamic content into placements on the fly.
   * @processFlow Merges payloads, clears stale tracking arrays, schedules pipeline microtask run.
   * @references `ClientAPI.fetchContent()`, `ClientAPI.addContentNodes()`, custom page handlers
   */
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
      const dataset = new Set(existingContentData.map(p => new Payload(p)));
      Supervisor.mergePayloads(dataset, payloads);

      await Supervisor.process({
        isValidationRun: false,
        runInstantiation: true,
        runAssembly: true,
        runPreprocessing: true,
        runValidation: true,
        runRendering: true,
        runPostprocessing: true,
        runMonitoring: true
      }, templateData, Array.from(dataset));
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
      Supervisor.instance.contentData = new Set();
    }

    // Clear tracking arrays on existing nodes before re-evaluating
    const contentNodesMap = Supervisor.instance.contentNodes;
    payloads.forEach(rawPayload => {
      const batchLabel = rawPayload.metadata?.batchLabel;
      for (const [key, nodes] of contentNodesMap.entries()) {
        if (key instanceof Payload && (key === rawPayload || (batchLabel && key.metadata?.batchLabel === batchLabel))) {
          nodes.forEach(node => node.clearTrackingArrays());
        }
      }
    });

    Supervisor.mergePayloads(Supervisor.instance.contentData, payloads);

    Supervisor.clearLockedPhases();
    await Supervisor.schedulePipeline();
  }

  /**
   * Completely reruns the pipeline from Phase 0 or target phase using optional configuration overrides.
   *
   * @param configOverride Partial PipelineConfig overrides.
   * @returns Promise resolving when rerun pipeline completes.
   * @useCase Complete layout rebuild or persistent state modification reload.
   * @processFlow Reset instantiation, clear internal state, execute `runPipeline()`.
   * @references `ClientAPI.modifyNode()` (when `_persistent` is `true`)
   */
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

  /**
   * Main instance execution loop draining phase queues in priority order (0 to 8).
   *
   * @returns Promise resolving to SSR result string (if SSR) or void (if client).
   * @useCase Priority queue loop processing phase workers in sequence.
   * @processFlow Drains worker queues sequentially (Phases 0 through 8), applying phase locks to prior completed phases.
   * @references `Supervisor.schedulePipeline()`, `Supervisor.process()`, `Supervisor.rerun()`
   */
  public async runPipeline(): Promise<string | void> {
    Supervisor.isPipelineRunning = true;
    try {
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
        for (let phaseId = 0; phaseId <= 8; phaseId++) {
          const worker = this.getWorkerForPhase(phaseId);
          if (worker && worker.hasEvents()) {
            Supervisor.currentStage = this.getStageNameForPhase(phaseId);
            // Lock prior phases when starting a higher phase queue
            for (let p = 0; p < phaseId; p++) {
              Supervisor.lockPhase(p);
            }
            if (phaseId === 1 || phaseId === 6 || phaseId === 7) {
              Supervisor.lockPhase(phaseId);
            }
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
    } finally {
      Supervisor.isPipelineRunning = false;
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
    this.hasInstantiated = true;
  }

  private async clearInternalState(): Promise<void> {
    StyleNode.clear();
    PlacementWorker.restoreAllPlacements();
    const payloadArray = Array.from(this.contentData);
    Node.globalMetadata = Object.assign({}, ...payloadArray.map(c => c.metadata || {}));
    const payloadWithUser = payloadArray.find(c => c.userData || c.metadata?.user);
    this.userData = payloadWithUser?.userData || payloadWithUser?.metadata?.user;
  }

  /**
   * Executes pipeline lifecycle handlers on the root node and content nodes for a given phase string.
   *
   * @param phase Lifecycle phase key (e.g. 'afterInstantiate', 'beforeRender', 'afterRender', 'beforeMonitor').
   * @references `Supervisor.process()`, `Supervisor.runPipeline()`, `Supervisor.monitor()`, `Supervisor.pauseMonitoring()`, `Supervisor.resumeMonitoring()`, worker queue handlers
   */
  public executeHandlers(phase: string): void {
    // TODO: Refactor executeHandlers to decouple lifecycle handler execution and optimize content node tree traversal.
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

  /** Starts the client-side monitoring loop and triggers `beforeMonitor` handlers. */
  private monitor(): void {
    Supervisor.currentStage = 'monitoring';
    Supervisor.clearLockedPhases();
    this.executeHandlers("beforeMonitor");
    this.isMonitoring = true;
    console.log("Stage: Monitoring started, state:", this.isMonitoring);
    console.log("Root node:", this.rootNode);
  }

  /** Pauses the client monitoring loop and triggers `onPause` handlers. */
  private pauseMonitoring(): void {
    this.executeHandlers("onPause");
    this.isMonitoring = false;
    console.log("Monitoring paused, state:", this.isMonitoring);
  }

  /** Resumes the client monitoring loop and triggers `onResume` handlers. */
  private resumeMonitoring(): void {
    Supervisor.currentStage = 'monitoring';
    Supervisor.clearLockedPhases();
    this.executeHandlers("onResume");
    this.isMonitoring = true;
    console.log("Monitoring resumed, state:", this.isMonitoring);
    console.log("Root node:", this.rootNode);
  }

  /** Terminates the Supervisor pipeline session, clears active phase locks and global metadata. */
  private close(): void {
    Supervisor.currentStage = 'closed';
    Supervisor.activeLockedPhases.clear();
    Supervisor.instance = null;
    Node.globalMetadata = {};
  }
}
