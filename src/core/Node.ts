import type { NodeData, NodeQuery, ComponentBinding, NextState, CompiledNodeState } from "../types/NodeSchema.js";
import { Supervisor } from "./Supervisor.js";
import { clientAPI } from "./ClientAPI.js";
import { NodeQueryUtils } from "./utils/NodeQueryUtils.js";
import { Component } from "./Component.js";
import { Handler } from "./Handler.js";
import { Css } from "./Css.js";
import { PhaseRegistry } from "./PhaseRegistry.js";
import { Placement } from "./Placement.js";
import { Props } from "./Props.js";
import { WorkerMessage } from "./WorkerMessage.js";
import { NodeLayer } from "./NodeLayer.js";
import { CompiledState } from "./CompiledState.js";

import { CloneUtils } from "./utils/CloneUtils.js";

/**
 * Core OOP class representing a Virtual DOM Node in Preempt.
 *
 * @useCase Fundamental building block of all Preempt UI elements, templates, and content components.
 * @processFlow Instantiated in Phase 0 (`InstantiationWorker`), reparented in Phase 1 (`PlacementWorker`), routed/assembled in Phases 2-4 (`ComponentRoutingWorker`/`ComponentAssemblyWorker`/`SlotAssemblyWorker`), preprocessed in Phase 5 (`PreprocessingWorker`), validated in Phase 6 (`ValidationWorker`), rendered in Phases 7-8 (`ClientElementCreationWorker`/`SSRElementCreationWorker` & `ClientTreeAssemblyWorker`/`SSRTreeAssemblyWorker`), and modified via atomic state updates (`receiveNextState`).
 */
export class Node {
  /** Map of HTML element tags to their required property attributes (e.g. img requiring src and alt). */
  public static readonly REQUIRED_PROPS_MAP: Record<string, string[]> = {
    "img": ["src", "alt"],
    "a": ["href"],
    "input": ["type"],
    "form": ["action"],
    "label": ["htmlFor"],
    "optgroup": ["label"],
    "option": ["value"],
    "textarea": ["rows", "cols"],
    "audio": ["src"],
    "video": ["src"],
    "source": ["src"],
    "track": ["src", "kind"],
    "embed": ["src"],
    "object": ["data"],
    "param": ["name"],
    "iframe": ["src"]
  };

  private _data!: NodeData;

  /**
   * Immutable NodeData payload initially provided during Node creation.
   *
   * @returns Read-only NodeData schema definition object.
   */
  public get data(): NodeData {
    return this._data;
  }

  public set data(_val: NodeData) {
    console.error("[Node] Error: 'data' property is read-only and cannot be mutated or reassigned.");
  }

  private _parent?: Node | null | undefined;

  /**
   * Parent Node in the Virtual DOM hierarchy.
   *
   * @returns Parent Node instance or null/undefined.
   */
  public get parent(): Node | null | undefined {
    return this._parent;
  }

  /**
   * Updates the parent Node reference, attaching children via change layers.
   *
   * @param newParent Target parent Node or null/undefined.
   */
  public set parent(newParent: Node | null | undefined) {
    const oldParent = this._parent;
    if (oldParent === newParent) return;

    this._parent = newParent;

    const idOrHash = this.css?.id || this.props?.id || (this as any).id || 'node';
    const childKey = `child:${idOrHash}`;

    if (oldParent) {
      oldParent.removeLayer('children', childKey);
      if (oldParent.placement) {
        for (const p of oldParent.placement) {
          if (p._referencingNodes) {
            p._referencingNodes.delete(this);
          }
        }
      }
    }

    if (newParent) {
      newParent.addLayer(new NodeLayer('children', childKey, 'append', [this]));
    }
  }

  /** Associated native browser HTMLElement reference (client-side only). */
  public element: HTMLElement | null = null;

  /** Validity flag set during Phase 5 validation. */
  public isValid: boolean = true;




  /** Layer stack keyed by targetProperty -> sourceName -> NodeLayer */
  private _layers: Map<string, Map<string, NodeLayer>> = new Map<string, Map<string, NodeLayer>>();
  private _compiledState: CompiledState | null = null;
  private _isDirty: boolean = true;
  private _baseCanon: Record<string, any> = {};

  /** Returns original baseCanon data schema for reconstruction purposes. */
  public get baseCanon(): Record<string, any> {
    return this._baseCanon;
  }

  /**
   * Adds or updates single-property change layer(s) on this Node.
   *
   * @param input A single NodeLayer instance, NodeLayer[], or Map<string, NodeLayer>.
   * @param phase Optional execution phase ID.
   */
  public addLayer(input: NodeLayer | NodeLayer[] | Map<string, NodeLayer>, phase?: number): void {
    let layersToProcess: NodeLayer[] = [];
    if (input instanceof Map) {
      layersToProcess = Array.from(input.values());
    } else if (Array.isArray(input)) {
      layersToProcess = input;
    } else if (input instanceof NodeLayer) {
      layersToProcess = [input];
    }

    for (const layer of layersToProcess) {
      if (phase !== undefined) {
        layer.phase = phase;
      }
      const layerPhase = layer.phase ?? phase ?? 99;

      if (layer.value instanceof Node) {
        if (layer.value.parent !== this) {
          layer.value = layer.value.clone([], [], this, layerPhase, false, 'addLayer');
        }
      } else if (Array.isArray(layer.value)) {
        layer.value = layer.value.map(item => {
          if (item instanceof Node && item.parent !== this) {
            return item.clone([], [], this, layerPhase, false, 'addLayer');
          }
          return item;
        });
      }

      let targetMap = this._layers.get(layer.targetProperty);
      if (!targetMap) {
        targetMap = new Map<string, NodeLayer>();
        this._layers.set(layer.targetProperty, targetMap);
      }
      if (targetMap.has(layer.sourceName)) {
        const oldLayer = targetMap.get(layer.sourceName);
        if (oldLayer && typeof oldLayer.delete === 'function') {
          oldLayer.delete();
        }
        targetMap.delete(layer.sourceName);
      }
      targetMap.set(layer.sourceName, layer);
      this._isDirty = true;
      console.log(`[Node] Added layer '${layer.sourceName}' targeting '${layer.targetProperty}' (mode: ${layer.mode}) on node ${this.css?.id || this.props?.id || 'unknown'}`);
    }
  }

  /**
   * Removes a layer matching targetProperty and sourceName.
   */
  public removeLayer(targetProperty: string, sourceName: string): void {
    const targetMap = this._layers.get(targetProperty);
    if (targetMap && targetMap.has(sourceName)) {
      const layer = targetMap.get(sourceName);
      if (layer && typeof layer.delete === 'function') {
        layer.delete();
      }
      targetMap.delete(sourceName);
      this._isDirty = true;
    }
  }

  /**
   * Removes all layers across all target properties that match the specified sourceName.
   */
  public removeLayersForSource(sourceName: string): void {
    for (const targetMap of this._layers.values()) {
      if (targetMap.has(sourceName)) {
        const layer = targetMap.get(sourceName);
        if (layer && typeof layer.delete === 'function') {
          layer.delete();
        }
        targetMap.delete(sourceName);
        this._isDirty = true;
      }
    }
  }



  /**
   * Invalidates the compiled state cache, forcing re-compilation on next property read.
   */
  public invalidateCompileCache(): void {
    this._isDirty = true;
  }

  /**
   * Compiles all node properties into compiledState. Reuses cached state if not dirty.
   */
  public compile(): CompiledNodeState {
    if (!this._isDirty && this._compiledState) {
      return this._compiledState;
    }

    const compileTarget = (targetProp: string): any => {
      const targetMap = this._layers.get(targetProp);
      if (!targetMap || targetMap.size === 0) {
        return undefined;
      }

      const layers = Array.from(targetMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      let lastReplaceAllIdx = -1;
      for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].mode === 'replaceAll') {
          lastReplaceAllIdx = i;
          break;
        }
      }

      const validLayers = lastReplaceAllIdx !== -1 ? layers.slice(lastReplaceAllIdx) : layers;

      let baseVal: any = undefined;
      let lastReplaceLayer = [...validLayers].reverse().find(l => l.mode === 'replace' || l.mode === 'replaceAll');
      if (lastReplaceLayer) {
        baseVal = lastReplaceLayer.value;
      }

      const isCollection = Array.isArray(baseVal) || targetProp === 'children' || targetProp === 'handlers';
      if (isCollection) {
        let resultArr = Array.isArray(baseVal) ? [...baseVal] : [];
        const appendStartIndex = lastReplaceLayer ? validLayers.indexOf(lastReplaceLayer) + 1 : 0;
        for (let i = appendStartIndex; i < validLayers.length; i++) {
          if (validLayers[i].mode === 'append') {
            const appVal = validLayers[i].value;
            if (Array.isArray(appVal)) {
              resultArr.push(...appVal);
            } else if (appVal !== undefined && appVal !== null) {
              resultArr.push(appVal);
            }
          }
        }
        return resultArr;
      }

      return baseVal;
    };

    const compiledType = compileTarget('type') || this._data?.type || 'div';
    const compiledContent = compileTarget('content') ?? this._data?.content;
    const compiledHandlers = compileTarget('handlers') || [];
    const compiledPlacement = compileTarget('placement') || [];
    const compiledComponent = compileTarget('component');

    // Construct fresh Props and Css OOP instances to merge sub-property layers
    const compiledProps = new Props(this._data?.props || {}, this);
    const compiledCss = new Css(this._data?.css || {}, this);

    // Apply sub-property layers for props.* and css.*
    for (const propKey of this._layers.keys()) {
      if (propKey.startsWith('props.')) {
        const subProp = propKey.slice(6);
        (compiledProps as any)[subProp] = compileTarget(propKey);
      } else if (propKey.startsWith('css.')) {
        const subCss = propKey.slice(4);
        if (subCss.startsWith('style.')) {
          const styleProp = subCss.slice(6);
          compiledCss.style = compiledCss.style || {};
          compiledCss.style[styleProp] = compileTarget(propKey);
        } else {
          (compiledCss as any)[subCss] = compileTarget(propKey);
        }
      }
    }



    // Children calculation combining native & placed children
    let compiledNativeChildren = compileTarget('children') || [];
    let placedChildren: Node[] = [];
    if (compiledPlacement && Array.isArray(compiledPlacement)) {
      for (const p of compiledPlacement) {
        if (p) {
          p.isInTree = this.isInTree;
          if (p._referencingNodes) {
            placedChildren = placedChildren.concat(Array.from(p._referencingNodes));
          }
        }
      }
    }
    const compiledChildren = [...compiledNativeChildren, ...placedChildren];

    this._compiledState = new CompiledState({
      type: compiledType,
      props: compiledProps,
      css: compiledCss,
      content: compiledContent,
      children: compiledChildren,
      nativeChildren: compiledNativeChildren,
      handlers: compiledHandlers,
      placement: compiledPlacement,
      component: compiledComponent,
      isValid: this.isValid
    });

    this._isDirty = false;
    return this._compiledState;
  }

  /** Read-only compiled state getter */
  public get compiledState(): CompiledState {
    if (this._isDirty || !this._compiledState) {
      this.compile();
    }
    return this._compiledState!;
  }

  // --- LAZY PROPERTY GETTERS ---
  public get type(): string {
    return this.compiledState.type;
  }

  public get props(): Props {
    return this.compiledState.props;
  }

  public get css(): Css {
    return this.compiledState.css;
  }

  public get content(): string | any {
    return this.compiledState.content;
  }

  public get nativeChildren(): Node[] {
    return this.compiledState.nativeChildren;
  }

  public get children(): Node[] {
    return this.compiledState.children;
  }

  public get handlers(): Handler[] | undefined {
    return this.compiledState.handlers;
  }

  public get placement(): Placement[] | undefined {
    return this.compiledState.placement;
  }

  public get component(): Component[] | undefined {
    return this.compiledState.component;
  }

  public versions?: any[] | undefined;
  public lastCompletedPhase?: number | undefined;
  public isInTree: boolean = false;

  public sourceComponents: Map<string, Component> = new Map();
  public targetComponents: Map<string, Component> = new Map();

  public messages: WorkerMessage[] = [];

  public addMessage(msg: WorkerMessage): void {
    this.messages.push(msg);
  }

  public getMessages(actorOrTargetWorker?: string, incompleteOnly: boolean = false): WorkerMessage[] {
    if (!actorOrTargetWorker) {
      return incompleteOnly ? this.messages.filter(m => !m.complete) : [...this.messages];
    }
    return this.messages.filter(m => {
      const matches = m.actor === actorOrTargetWorker || m.targetWorker === actorOrTargetWorker;
      return matches && (!incompleteOnly || !m.complete);
    });
  }

  public clearMessages(): void {
    for (const msg of this.messages) {
      msg.delete();
    }
    this.messages = [];
  }

  public _attachedListeners: { eventName: string, handlerFunc: EventListener }[] = [];

  public static globalMetadata: any = {};
  public static idCollisions = new Map<string, number>();

  /**
   * Generates a deterministic, cycle-safe hash string from a NodeData object to produce unique node IDs.
   *
   * @param obj NodeData object or sub-structure to hash.
   * @returns Generated CSS ID string (e.g. 'preempt-node-a1b2c3d4').
   * @useCase Auto-generating unique CSS IDs during Phase 0 Node instantiation.
   * @processFlow Phase 0 node setup.
   * @references `Node.constructor`, `Node.receiveNextState()`, `Placement.constructor`
   */
  public static generateObjectHash(obj: any): string {
    const HASH_IGNORE_KEYS = new Set([
      'node', 'css', '_instantiatedNodes', '_referencingNodes',
      'parent', 'children', 'nativeChildren', 'originalParent'
    ]);
    const replacer = (k: string, v: any) => {
      if (HASH_IGNORE_KEYS.has(k)) return undefined;
      return v;
    };
    const str = JSON.stringify(obj, replacer) || "";
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }

    const baseId = `preempt-node-${Math.abs(hash).toString(36)}`;
    let count = Node.idCollisions.get(baseId) || 0;
    count++;
    Node.idCollisions.set(baseId, count);

    if (count > 1) {
      return `${baseId}-${count}`;
    }
    return baseId;
  }

  /**
   * Parses component bindings and updates `sourceComponents` (value providers) and `targetComponents` (injection targets).
   *
   * @param components Array of raw component bindings or Component instances.
   * @param phase Execution phase ID.
   * @references `Node.constructor`, `Node.clone()`, `Component.mergeComponents()`
   */
  public setComponents(components: ComponentBinding[] | undefined, phase: number = 0): void {
    if (components === undefined) {
      this.removeLayer('component', 'baseCanon');
    } else {
      let filtered = components.filter(c => c !== null).map(c => c instanceof Component ? (c.parent = this, c) : new Component(c, this, phase, false));
      this.sourceComponents.clear();
      this.targetComponents.clear();
      filtered.forEach(c => {
        if (c.target) {
          if (this.targetComponents.get(c.target) !== undefined) {
            console.error(`[Node] Duplicate target component defined for target: ${c.target} on node '${this.css?.id || this.type}'`, this);
          }
          this.targetComponents.set(c.target, c);
        }
        if (c.value !== undefined) {
          this.sourceComponents.set(c.reference, c);
        }
      });

      if (filtered.length > 0) {
        this.addLayer(new NodeLayer('component', 'baseCanon', 'replace', filtered, phase));
      } else {
        this.removeLayer('component', 'baseCanon');
      }
    }
  }

  /**
   * Constructs a new Node instance from JSON schema data.
   *
   * @param data NodeData raw JSON schema object.
   * @param parent Parent Node instance or null/undefined.
   * @param phase Execution phase ID.
   * @param isInTree Boolean indicating if node is attached to the active tree.
   * @param isClone Boolean flag set if node is being created as a duplicate clone.
   * @references `InstantiationWorker.regenerateNode()`, `ComponentAssemblyWorker.processNode()`, `SlotAssemblyWorker.processNode()`, `Node.mergeNativeChildren()`, `Node.clone()`, `Template.constructor`, `Payload.constructor`
   */
  constructor(data: NodeData, parent: Node | null | undefined, phase: number, isInTree: boolean = false, isClone: boolean = false, source: string = 'baseCanon') {
    this._data = data;
    this._baseCanon = { ...data };
    this.isInTree = isInTree;

    const rawProps = new Props(this._data.props || {}, this);
    const rawCss = new Css(this._data.css || {}, this);

    const hasExplicitPropsId = Boolean(this._data.props?.id && !String(this._data.props.id).startsWith('preempt-node-'));
    const hasExplicitCssId = Boolean(this._data.css?.id && !String(this._data.css.id).startsWith('preempt-node-'));

    if (!hasExplicitPropsId && !hasExplicitCssId) {
      rawProps.isIdAutoGenerated = true;
      const generatedId = isClone ? Node.generateObjectHash(this._data) : (this._data.css?.id || this._data.props?.id || Node.generateObjectHash(this._data));
      rawProps.id = generatedId;
      rawCss.id = generatedId;
    } else {
      if (!rawCss.id) {
        rawCss.id = rawProps.id || Node.generateObjectHash(this._data);
      }
      if (!rawProps.id) {
        rawProps.id = rawCss.id;
      }
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && rawCss.id) {
      const existingEl = document.getElementById(rawCss.id);
      if (existingEl) {
        this.element = existingEl;
      }
    }

    const initialLayers: NodeLayer[] = [];
    const sourceName = source;

    initialLayers.push(new NodeLayer('type', sourceName, 'replaceAll', this._data.type || 'div', phase));

    if (this._data.content !== undefined) {
      initialLayers.push(new NodeLayer('content', sourceName, 'replaceAll', this._data.content, phase));
    }

    if (rawProps.id) {
      initialLayers.push(new NodeLayer('props.id', sourceName, 'replaceAll', rawProps.id, phase));
    }
    if (this._data.props) {
      for (const [pKey, pVal] of Object.entries(this._data.props)) {
        if (pKey !== 'id') {
          initialLayers.push(new NodeLayer(`props.${pKey}`, sourceName, 'replaceAll', pVal, phase));
        }
      }
    }

    if (rawCss.id) {
      initialLayers.push(new NodeLayer('css.id', sourceName, 'replaceAll', rawCss.id, phase));
    }
    if (this._data.css) {
      if (this._data.css.classes && Array.isArray(this._data.css.classes)) {
        initialLayers.push(new NodeLayer('css.classes', sourceName, 'replaceAll', [...this._data.css.classes], phase));
      }
      if (this._data.css.style && typeof this._data.css.style === 'object') {
        for (const [sKey, sVal] of Object.entries(this._data.css.style)) {
          initialLayers.push(new NodeLayer(`css.style.${sKey}`, sourceName, 'replaceAll', sVal, phase));
        }
      }
    }

    if (!isClone) {
      const childNodes: Node[] = [];
      const emitNonePhase = PhaseRegistry.EMIT_NONE;
      if ((phase === 0 || phase === 99 || phase === emitNonePhase) && this._data.children && Array.isArray(this._data.children)) {
        for (const childData of this._data.children) {
          if (childData && typeof childData === 'object') {
            const childNode = new Node(childData, this, phase, this.isInTree, false, sourceName);
            childNodes.push(childNode);
          }
        }
      }
      if (childNodes.length > 0) {
        initialLayers.push(new NodeLayer('children', sourceName, 'replaceAll', childNodes, phase));
      }

      if (this._data.handlers && Array.isArray(this._data.handlers)) {
        const handlersArr = this._data.handlers.map(h => new Handler(h, this, phase));
        initialLayers.push(new NodeLayer('handlers', sourceName, 'replaceAll', handlersArr, phase));
      }

      if (this._data.component) {
        this.setComponents(this._data.component, phase);
      }

      if (this._data.placement && Array.isArray(this._data.placement)) {
        const placementArr = this._data.placement.map((p: any) => new Placement(p, this, phase, this.isInTree));
        initialLayers.push(new NodeLayer('placement', sourceName, 'replaceAll', placementArr, phase));
      } else if (this._data.placement && typeof this._data.placement === 'object') {
        const placementArr = [new Placement(this._data.placement as any, this, phase, this.isInTree)];
        initialLayers.push(new NodeLayer('placement', sourceName, 'replaceAll', placementArr, phase));
      }
    }

    this.addLayer(initialLayers, phase);

    this.parent = parent;

    const validationPhase = PhaseRegistry.getPhaseNumber('validation');
    if (this.isInTree && phase <= validationPhase) {
      Supervisor.emitToPhaseName(this, this, 'validation');
    }

    console.log(`[Node] Created node '${this.css?.id || this.type}' (type: ${this.type}, phase: ${phase}, isInTree: ${this.isInTree})`, this);
  }

  /**
   * Clears tracking references across placement and component bindings before re-evaluating layout payload updates.
   *
   * @references `Supervisor.injectContent()`
   */
  public clearTrackingArrays(): void {
    if (this.placement) {
      for (const p of this.placement) {
        if (p._referencingNodes) {
          for (const clone of p._referencingNodes) {
            clone.delete();
          }
          p._referencingNodes = new Set();
        }
      }
    }
    if (this.component) {
      for (const c of this.component) {
        if (c._referencingNodes) c._referencingNodes = new Set();
      }
    }
    if (this.children && Array.isArray(this.children)) {
      for (const child of this.children) {
        if (child) child.clearTrackingArrays();
      }
    }
  }

  /**
   * Destroys this Node, removing it from parent nativeChildren, unmounting native DOM elements, and releasing children/styles.
   *
   * @references `Node.clearTrackingArrays()`, `Node.mergeNativeChildren()`, `Placement.delete()`, `Component.delete()`, `Css.delete()`, `StyleNode.delete()`, `Props.delete()`, `Handler.delete()`
   */
  public delete(): void {
    this.parent = undefined;

    if (this.placement && Array.isArray(this.placement)) {
      for (const p of this.placement) {
        if (p && p.delete) p.delete();
      }
    }

    // Recursively delete native children
    while (this.nativeChildren.length > 0) {
      const child = this.nativeChildren.pop();
      if (child) {
        child.delete();
      }
    }


    if (this.css && this.css.delete) {
      this.css.delete();
    }

    if (this.props) {
      if ((this.props as any).delete) {
        (this.props as any).delete();
      }
      delete (this as any).props;
    }

    if (this.component) {
      for (const c of this.component) {
        if (c && c.delete) {
          c.delete();
        }
      }
    }

    if (this.handlers) {
      for (const h of this.handlers) {
        if (h && h.delete) {
          h.delete();
        }
      }
    }

    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }



  /**
   * Receives atomic state updates for this Node, checks property locks, updates state, and emits node to Supervisor stage.
   *
   * @param nextState Partial Node state object containing updated properties (css, props, content, children, etc.).
   * @param explicitPhaseId Optional explicit phase ID to emit to.
   * @useCase Invoked by `ClientAPI.modifyNode()` to push atomic state updates onto a node queue without full pipeline re-instantiation.
   * @processFlow State update ingestion and event emission to Supervisor.
   * @references `ClientAPI.modifyNode()`, `WebSocketClient.onMessage()`, custom page event handlers
   */
  public receiveNextState(nextState: NextState, explicitPhaseId?: number): void {
    const changedKeys = Object.keys(nextState);
    if (changedKeys.length === 0) {
      if (explicitPhaseId !== undefined) {
        if (Supervisor.isPhaseLocked(explicitPhaseId)) {
          console.error(`[Node] Lock violation: Phase ${explicitPhaseId} is already locked for node ${this.css?.id}`);
          return;
        }
        this.lastCompletedPhase = explicitPhaseId > 0 ? explicitPhaseId - 1 : undefined;
        Supervisor.emitToPhase(this, this, explicitPhaseId);
      }
      return;
    }

    this.clearMessages();
    const stateMsg = new WorkerMessage('nextState');
    for (const key of changedKeys) {
      stateMsg.changelog[key] = {
        oldValue: (this as any)[key],
        newValue: (nextState as any)[key]
      };
    }
    this.addMessage(stateMsg);

    if (nextState.placement !== undefined) {
      const nextPlacementHash = Node.generateObjectHash(nextState.placement);
      const currentPlacementHash = Node.generateObjectHash(this.placement);
      if (nextPlacementHash !== currentPlacementHash) {
        console.error(`[Node] receiveNextState rejected: Cannot modify placement data via receiveNextState. Please update the node.data state and pass the layout change to Supervisor/InstantiationWorker so the node tree can be properly rebuilt. Node ID: ${this.css?.id}`);
        return;
      }
    }

    const validationPhase = PhaseRegistry.getPhaseNumber('validation');
    let minTargetPhase: number = explicitPhaseId !== undefined ? explicitPhaseId : validationPhase;
    let lockFailed = false;

    if (explicitPhaseId !== undefined && Supervisor.isPhaseLocked(explicitPhaseId)) {
      console.error(`[Node] Lock violation: Phase ${explicitPhaseId} is already locked for node ${this.css?.id}`);
      return;
    }

    for (const key of changedKeys) {
      let phaseResult: number | undefined = undefined;
      if (key === 'props' && nextState.props !== undefined) {
        phaseResult = this.props.merge(nextState.props);
        this.data.props = { ...this.props };
      } else if (key === 'css' && nextState.css !== undefined) {
        phaseResult = this.css.merge(nextState.css);
        this.data.css = { id: this.css.id, classes: this.css.classes, style: this.css.style };
      } else if (key === 'component' && nextState.component !== undefined) {
        phaseResult = Component.mergeComponents(this, nextState.component);
      } else if (key === 'handlers' && nextState.handlers !== undefined) {
        phaseResult = Handler.mergeHandlers(this, nextState.handlers);
      } else if ((key === 'children' || key === 'nativeChildren') && (nextState as any)[key] !== undefined) {
        const childrenVal = (nextState as any)[key];
        this.addLayer(new NodeLayer('children', 'receiveNextState', 'replace', childrenVal, minTargetPhase));
        phaseResult = validationPhase;
      } else if (key !== 'placement') {
        if (Supervisor.isPropertyLocked(key)) {
          console.error(`[Node] Lock violation: Property '${key}' is currently locked for node ${this.css?.id}`);
          lockFailed = true;
          break;
        }
        (this.data as any)[key] = (nextState as any)[key];
        const mappedPhase = Supervisor.propertyToPhaseMap ? Supervisor.propertyToPhaseMap[key] : validationPhase;
        if (mappedPhase !== undefined) {
          phaseResult = mappedPhase;
        }
      }

      if (phaseResult === undefined && key !== 'placement') {
        lockFailed = true;
        break;
      }
      if (phaseResult !== undefined && (explicitPhaseId === undefined || phaseResult < minTargetPhase)) {
        minTargetPhase = phaseResult;
      }
    }

    if (lockFailed) {
      return;
    }

    const targetPhase = minTargetPhase;
    this.lastCompletedPhase = targetPhase > 0 ? targetPhase - 1 : undefined;

    // Check for all phase handlers and emit host node to all matching stage phases via Supervisor.emitToPhaseName
    if (this.handlers && this.handlers.length > 0) {
      const emittedStages = new Set<string>();
      for (const h of this.handlers) {
        if (h.phase) {
          const stageName = Handler.getStageName(h.phase);
          if (stageName && !emittedStages.has(stageName)) {
            emittedStages.add(stageName);
            Supervisor.emitToPhaseName(this, this, stageName);
          }
        }
      }
    }

    // Emit to primary target phase
    Supervisor.emitToPhase(this, this, targetPhase);

    // receiveNextState must always emit to ValidationWorker (validation phase)
    if (targetPhase !== validationPhase) {
      Supervisor.emitToPhaseName(this, this, 'validation');
    }
  }



  /**
   * Tests whether this node matches the provided query criteria.
   *
   * @param query NodeQuery criteria or matching predicate.
   * @returns `true` if matching, `false` otherwise.
   * @references `NodeQueryUtils.isMatch()`, `Node.findNode()`, `Node.findNodes()`
   */
  public isMatch(query: NodeQuery | ((node: Node) => boolean)): boolean {
    return NodeQueryUtils.isMatch(this, query);
  }

  /**
   * Recursively searches this node sub-tree and returns all matching Node instances.
   *
   * @param query NodeQuery criteria or matching predicate.
   * @returns Array of matching Node instances.
   * @references `NodeQueryUtils.findNodes()`, `PostprocessingWorker.emitTo()`, custom handlers
   */
  public findNodes(query: NodeQuery | ((node: Node) => boolean)): Node[] {
    return NodeQueryUtils.findNodes(this, query);
  }

  /**
   * Recursively searches this node sub-tree and returns the first matching Node instance.
   *
   * @param query NodeQuery criteria or matching predicate.
   * @param depth Current search depth (default 0).
   * @returns Matching Node instance or null if not found.
   * @references `NodeQueryUtils.findNode()`, `Supervisor.executeHandlers()`, `ClientAPI.modifyNode()`, `ClientAPI.compileHandler()`, custom handlers
   */
  public findNode(query: NodeQuery | ((node: Node) => boolean), depth: number = 0): Node | null {
    return NodeQueryUtils.findNode(this, query, depth);
  }

  /**
   * Executes lifecycle or event handlers matching the target phase or event name string.
   *
   * @param target Target phase string (e.g. 'beforeAssembly', 'afterRender') or event name.
   * @param context Execution context dictionary.
   * @param recursive If `true`, executes handlers recursively down child nodes.
   * @references `Supervisor.executeHandlers()`, worker queue stage executions across all pipeline phases (0-8)
   */
  public executeHandlers(target: string, context: any, recursive: boolean = true): void {
    if (this.handlers && Array.isArray(this.handlers)) {
      for (const handler of this.handlers) {
        if (handler.phase === target || handler.event === target) {
          try {
            const fullContext = {
              ...context,
              node: this,
              metadata: Node.globalMetadata,
              rootNode: Supervisor.getRootNode(),
              contentPayload: Supervisor.instance?.contentData || [],
              clientAPI,
              supervisor: Supervisor.instance
            };
            handler.execute(null, fullContext);
          } catch (err) {
            console.error(`Failed to execute ${target} handler on node:`, err);
          }
        }
      }
    }

    if (recursive && this.children && Array.isArray(this.children)) {
      for (const child of this.children) {
        if (child) {
          child.executeHandlers(target, context, recursive);
        }
      }
    }
  }

  /**
   * Exports a clean `NodeData` JSON schema structure representing this node and sub-tree, stripping transient internal IDs.
   *
   * @returns Clean NodeData JSON structure.
   * @references `Supervisor.exportRootNode()`, `InstantiationWorker.regenerateNode()`, `Template.exportToJson()`
   */
  public exportToJson(): NodeData {
    const cleanData = (data: any) => {
      if (!data) return data;
      const d = { ...data };
      if (d.css) {
        d.css = { ...d.css };
        if (d.css.id && d.css.id.startsWith("preempt-node-")) {
          delete d.css.id;
        }
        if (Object.keys(d.css).length === 0) {
          delete d.css;
        }
      }
      if (d.props) {
        d.props = { ...d.props };
        if (d.props.id && d.props.id.startsWith("preempt-node-")) {
          delete d.props.id;
        }
        if (Object.keys(d.props).length === 0) {
          delete d.props;
        }
      }
      if (d.component && Array.isArray(d.component) && d.component.length === 0) {
        delete d.component;
      }
      if (Array.isArray(d.content)) {
        d.content = d.content.map((c: any) => cleanData(c));
      } else if (typeof d.content === 'object' && d.content !== null) {
        d.content = cleanData(d.content);
      }
      return d;
    };

    return cleanData(this.data);
  }

  /**
   * Deep clones this Node instance, its properties, component bindings, handlers, and native child sub-trees.
   *
   * @param ignoreProps Array of property names to exclude from cloning.
   * @param shallowCopyProps Array of property names to copy by reference.
   * @param newParent Target parent Node for the cloned instance.
   * @param phase Execution phase ID.
   * @param isComponent Boolean indicating if cloned node represents a component root.
   * @returns Deep cloned Node instance.
   * @references `CloneUtils.deepClone()`, `ComponentAssemblyWorker.processNode()`, `SlotAssemblyWorker.processNode()`, `Node.receiveNextState()`, `Node.clone()`, `Component.cloneNode()`, `Template.clone()`, `Payload.clone()`
   */
  public clone(
    ignoreProps: string[] = [],
    _shallowCopyProps: string[] = [],
    newParent: Node | null | undefined,
    phase: number,
    isComponent: boolean = false,
    actor: string = 'Snapshot'
  ): Node {
    const clonedData = this.data;
    const targetParent = isComponent ? undefined : newParent;
    const targetPhase = isComponent ? 99 : phase;
    let targetIsInTree = false;
    if (!isComponent) {
      if (newParent === null) {
        targetIsInTree = true;
      } else if (newParent) {
        targetIsInTree = newParent.isInTree;
      }
    }
    const clonedNode = new Node(clonedData, targetParent, targetPhase, targetIsInTree, true);

    const cloneMsg = new WorkerMessage(actor);
    clonedNode.addMessage(cloneMsg);

    // Deep clone non-baseCanon change layers from this._layers to clonedNode
    for (const [targetProp, sourceMap] of this._layers.entries()) {
      if (ignoreProps.includes(targetProp)) continue;
      if (targetProp.startsWith('props.') && ignoreProps.includes('props')) continue;
      if (targetProp.startsWith('css.') && ignoreProps.includes('css')) continue;
      if (targetProp.startsWith('children') && (ignoreProps.includes('children') || ignoreProps.includes('nativeChildren'))) continue;

      for (const [sourceName, layer] of sourceMap.entries()) {
        if (sourceName === 'baseCanon') continue;
        clonedNode.addLayer(layer.clone(ignoreProps, _shallowCopyProps, clonedNode, targetPhase, isComponent, actor));
      }
    }

    if (!ignoreProps.includes('component')) {
      if (this.component) {
        const clonedComponents = this.component.map(c => c.clone(ignoreProps, clonedNode, targetPhase, actor));
        clonedNode.setComponents(clonedComponents, targetPhase);
      }
    }

    clonedNode.versions = CloneUtils.deepClone(this.versions);

    // Keep clonedNode.css.id synchronized with clonedNode.props.id for auto-generated or regenerated IDs
    if (this.props?.isIdAutoGenerated || clonedNode.props?.isIdAutoGenerated) {
      clonedNode.props.isIdAutoGenerated = true;
      if (clonedNode.props.id && clonedNode.css) {
        clonedNode.css.id = clonedNode.props.id;
      }
    } else if (clonedNode.props?.id && clonedNode.css && !ignoreProps.includes('css') && !ignoreProps.includes('props')) {
      clonedNode.css.id = clonedNode.props.id;
    }

    return clonedNode;
  }
}
