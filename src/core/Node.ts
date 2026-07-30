import type { NodeData, NodeQuery, ComponentBinding, NextState, RollbackState } from "../types/NodeSchema.js";
import { Supervisor } from "./Supervisor.js";
import { clientAPI } from "./ClientAPI.js";
import { NodeQueryUtils } from "./utils/NodeQueryUtils.js";
import { Component } from "./Component.js";
import { Handler } from "./Handler.js";
import { Css } from "./Css.js";
import { Placement } from "./Placement.js";
import { Props } from "./Props.js";

import { CloneUtils } from "./utils/CloneUtils.js";

/**
 * Core OOP class representing a Virtual DOM Node in Preempt.
 *
 * @useCase Fundamental building block of all Preempt UI elements, templates, and content components.
 * @processFlow Instantiated in Phase 0 (`InstantiationWorker`), reparented in Phase 1 (`PlacementWorker`), assembled in Phases 2-3 (`ComponentAssemblyWorker`/`SlotAssemblyWorker`), validated in Phase 5 (`ValidationWorker`), rendered in Phases 6-7 (`ClientElementCreationWorker`/`SSRElementCreationWorker` & `ClientTreeAssemblyWorker`/`SSRTreeAssemblyWorker`), and modified via atomic state updates (`receiveNextState`).
 */
export class Node {
  /** Map of HTML element tags to their required property attributes (e.g. img requiring src and alt). */
  public static readonly REQUIRED_PROPS_MAP: Record<string, string[]> = {
    "img": ["src", "alt"],
    "a": ["href"],
    "iframe": ["src"],
    "form": ["action"],
    "video": ["src"],
    "audio": ["src"],
    "source": ["src"]
  };

  private _data!: NodeData;

  /**
   * Underlying raw `NodeData` JSON schema object.
   *
   * @returns Read-only NodeData schema.
   */
  public get data(): NodeData {
    return this._data;
  }

  public set data(_val: NodeData) {
    console.error("[Node] Error: 'data' property is read-only and cannot be mutated or reassigned.");
  }

  /** Rollback snapshot saved for error recovery. */
  public _lastValidState?: RollbackState;

  /** Array of directly owned child Node instances. */
  public nativeChildren: Node[] = [];
  private _childrenCache: Node[] | null = null;
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
   * Updates the parent Node reference, handling list detachment and cache invalidation.
   *
   * @param newParent Target parent Node or null/undefined.
   */
  public set parent(newParent: Node | null | undefined) {
    if (this._parent === newParent) return;

    if (this._parent) {
      // Remove from former parent's nativeChildren
      const idx = this._parent.nativeChildren.indexOf(this);
      if (idx !== -1) {
        this._parent.nativeChildren.splice(idx, 1);
      }
      // Remove from former parent's placement _referencingNodes if placed
      if (this._parent.placement) {
        for (const p of this._parent.placement) {
          if (p._referencingNodes) {
            p._referencingNodes.delete(this);
          }
        }
      }
      this._parent.invalidateChildrenCache();
    }

    this._parent = newParent;

    if (newParent) {
      if (!newParent.children.includes(this)) {
        newParent.nativeChildren.push(this);
      }
      newParent.invalidateChildrenCache();
    }
  }

  /** Associated native browser HTMLElement reference (client-side only). */
  public element: HTMLElement | null = null;

  /** Validity flag set during Phase 5 validation. */
  public isValid: boolean = true;


  /**
   * Computed array combining native child nodes and placed child nodes.
   *
   * @returns Array of all active child Node instances.
   */
  public get children(): Node[] {
    if (this._childrenCache) return this._childrenCache;
    let placedChildren: Node[] = [];
    if (this.placement) {
      for (const p of this.placement) {
        if (p._referencingNodes) {
          placedChildren = placedChildren.concat(Array.from(p._referencingNodes));
        }
      }
    }
    this._childrenCache = [...this.nativeChildren, ...placedChildren];
    return this._childrenCache;
  }

  public set children(val: Node[]) {
    this.nativeChildren = val;
    this.invalidateChildrenCache();
  }

  /**
   * Invalidates the cached children array for this node and bubbles cache invalidation up to the parent chain.
   */
  public invalidateChildrenCache(): void {
    this._childrenCache = null;
    if (this.parent) this.parent.invalidateChildrenCache();
  }

  /** HTML tag type (e.g. 'div', 'button', 'header'). */
  public type: string = 'div';
  public placement: Placement[];
  public component?: Component[] | undefined;
  public content?: string | any | undefined;
  public props: Props;
  public handlers?: Handler[] | undefined;
  public css: Css = new Css();
  public versions?: any[] | undefined;
  public lastCompletedPhase?: number | undefined;
  public isInTree: boolean = false;

  public sourceComponents: Map<string, Component> = new Map();
  public targetComponents: Map<string, Component> = new Map();

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
      delete this.component;
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
        this.component = filtered;
      } else {
        delete this.component;
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
  constructor(data: NodeData, parent: Node | null | undefined, phase: number, isInTree: boolean = false, isClone: boolean = false) {
    this._data = data;
    this.parent = parent;
    this.isInTree = isInTree;

    this.props = new Props(this._data.props || {}, this);
    this.css = new Css(this._data.css || {}, this);
    if (!this._data.props?.id && !this._data.css?.id) {
      this.props.isIdAutoGenerated = true;
    }
    if (!this.css.id) {
      this.css.id = this.props.id || Node.generateObjectHash(this._data);
    }
    if (!this.props.id) {
      this.props.id = this.css.id;
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && this.css.id) {
      const existingEl = document.getElementById(this.css.id);
      if (existingEl) {
        this.element = existingEl;
      }
    }

    this.type = this._data.type;

    if (typeof this._data.content === 'string') {
      this.content = this._data.content;
    }

    if (!isClone) {
      if ((phase === 0 || phase === 99) && this._data.children && Array.isArray(this._data.children)) {
        for (const childData of this._data.children) {
          if (childData && typeof childData === 'object') {
            new Node(childData, this, phase, this.isInTree); //Child adds to nativeChildren via parent setter
          }
        }
      }

      if (this._data.handlers && Array.isArray(this._data.handlers)) {
        this.handlers = this._data.handlers.map(h => new Handler(h, this, phase));
      } else {
        this.handlers = [];
      }

      this.setComponents(this._data.component, phase);

      if (this._data.placement && Array.isArray(this._data.placement)) {
        this.placement = this._data.placement.map((p: any) => new Placement(p, this, phase, this.isInTree));
      } else if (this._data.placement && typeof this._data.placement === 'object') {
        this.placement = [new Placement(this._data.placement as any, this, phase, this.isInTree)];
      } else {
        this.placement = [];
      }
    } else {
      this.handlers = [];
      this.placement = [];
    }

    if (this.isInTree && phase <= 5) {
      Supervisor.emitToPhase(this, this, {}, 5); // Emit to Phase 5: ValidationWorker
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
    if (this.parent) {
      const index = this.parent.nativeChildren.indexOf(this);
      if (index > -1) {
        this.parent.nativeChildren.splice(index, 1);
        this.parent.invalidateChildrenCache();
      }
    }

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
   * Replaces native children with new Node or NodeData entries.
   *
   * @param incomingNativeChildren Array of raw NodeData schemas or Node instances.
   * @returns Phase ID 7 for tree assembly re-run.
   * @references `Node.receiveNextState()`
   */
  public mergeNativeChildren(incomingNativeChildren: any[]): number | undefined {
    if (Supervisor.isPropertyLocked('nativeChildren')) {
      console.error(`[Node] Lock violation: Property 'nativeChildren' is currently locked for node ${this.css?.id || 'unknown'}`);
      return undefined;
    }
    while (this.nativeChildren && this.nativeChildren.length > 0) {
      const child = this.nativeChildren.pop();
      if (child && typeof child.delete === 'function') {
        child.delete();
      }
    }

    const newNativeChildren: Node[] = [];
    for (const item of incomingNativeChildren) {
      if (item instanceof Node) {
        item.parent = this;
        item.isInTree = this.isInTree;
        newNativeChildren.push(item);
      } else if (item && typeof item === 'object') {
        const childNode = new Node(item as NodeData, this, 0, this.isInTree);
        newNativeChildren.push(childNode);
      }
    }
    this.nativeChildren = newNativeChildren;
    this.data.children = newNativeChildren.map(c => c.data);
    this.invalidateChildrenCache();
    return 7;
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
        Supervisor.emitToPhase(this, this, this._lastValidState, explicitPhaseId);
      }
      return;
    }

    if (nextState.placement !== undefined) {
      const nextPlacementHash = Node.generateObjectHash(nextState.placement);
      const currentPlacementHash = Node.generateObjectHash(this.placement);
      if (nextPlacementHash !== currentPlacementHash) {
        console.error(`[Node] receiveNextState rejected: Cannot modify placement data via receiveNextState. Please update the node.data state and pass the layout change to Supervisor/InstantiationWorker so the node tree can be properly rebuilt. Node ID: ${this.css?.id}`);
        return;
      }
    }

    // Snapshot state
    if (!this._lastValidState) {
      this._lastValidState = this.clone(['content', 'children', 'nativeChildren', '_childrenCache', 'parent', 'element'], [], null, 99);
      this._lastValidState.nativeChildren = [...this.nativeChildren];
    }

    let minTargetPhase: number = explicitPhaseId !== undefined ? explicitPhaseId : 5;
    let lockFailed = false;

    if (explicitPhaseId !== undefined && Supervisor.isPhaseLocked(explicitPhaseId)) {
      console.error(`[Node] Lock violation: Phase ${explicitPhaseId} is already locked for node ${this.css?.id}`);
      return;
    }

    for (const key of changedKeys) {
      let phaseResult: number | undefined = undefined;
      if (key === 'props' && nextState.props !== undefined) {
        if (!this.props) this.props = new Props({}, this);
        phaseResult = this.props.merge(nextState.props);
        this.data.props = { ...this.props };
      } else if (key === 'css' && nextState.css !== undefined) {
        if (!this.css) this.css = new Css({}, this);
        phaseResult = this.css.merge(nextState.css);
        this.data.css = { id: this.css.id, classes: this.css.classes, style: this.css.style };
      } else if (key === 'component' && nextState.component !== undefined) {
        phaseResult = Component.mergeComponents(this, nextState.component);
      } else if (key === 'handlers' && nextState.handlers !== undefined) {
        phaseResult = Handler.mergeHandlers(this, nextState.handlers);
      } else if (key === 'children' && nextState.children !== undefined && Array.isArray(nextState.children)) {
        phaseResult = this.mergeNativeChildren(nextState.children);
      } else if (key === 'nativeChildren' && nextState.nativeChildren !== undefined && Array.isArray(nextState.nativeChildren)) {
        phaseResult = this.mergeNativeChildren(nextState.nativeChildren);
      } else if (key !== 'placement') {
        if (Supervisor.isPropertyLocked(key)) {
          console.error(`[Node] Lock violation: Property '${key}' is currently locked for node ${this.css?.id}`);
          lockFailed = true;
          break;
        }
        (this as any)[key] = (nextState as any)[key];
        (this.data as any)[key] = (nextState as any)[key];
        const mappedPhase = Supervisor.propertyToPhaseMap ? Supervisor.propertyToPhaseMap[key] : 5;
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
    Supervisor.emitToPhase(this, this, this._lastValidState, targetPhase);
  }

  /**
   * Restores a previously saved valid state snapshot on error.
   *
   * @param rollbackState Optional explicit rollback state.
   * @references `BaseWorker.onProcessError()`
   */
  public rollback(rollbackState?: RollbackState): void {
    const stateToRestore = rollbackState || this._lastValidState;
    if (stateToRestore) {
      if ((stateToRestore as any).data) {
        Object.assign(this.data, (stateToRestore as any).data);
      } else {
        Object.assign(this.data, stateToRestore);
      }
      Object.assign(this, stateToRestore);
      console.warn(`[Node] Rolled back to previous valid state for node ${this.css?.id}`);
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
      if (d.props && Object.keys(d.props).length === 0) {
        delete d.props;
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
  public clone(ignoreProps: string[] = [], shallowCopyProps: string[] = [], newParent: Node | null | undefined, phase: number, isComponent: boolean = false): Node {
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


    clonedNode.type = this.type;

    if (!ignoreProps.includes('css')) {
      clonedNode.css = this.css ? this.css.clone(ignoreProps, clonedNode) : new Css({}, clonedNode);
    }
    if (!ignoreProps.includes('placement')) {
      clonedNode.placement = this.placement ? this.placement.map(p => p.clone(ignoreProps, clonedNode, targetPhase)) : [];
    }
    if (!ignoreProps.includes('content')) {
      clonedNode.content = this.content ? this.content : undefined;
    }
    if (!ignoreProps.includes('props')) {
      if (this.props) {
        const clonedProps = this.props.clone(ignoreProps, clonedNode);
        clonedNode.props.merge(clonedProps);
      }
    }
    if (!ignoreProps.includes('handlers')) {
      if (this.handlers && Array.isArray(this.handlers)) {
        clonedNode.handlers = this.handlers.map(h => h.clone(clonedNode, targetPhase));
      }
    }
    if (!ignoreProps.includes('component')) {
      if (this.component) {
        const clonedComponents = this.component.map(c => c.clone(ignoreProps, clonedNode, targetPhase));
        clonedNode.setComponents(clonedComponents, targetPhase);
      }
    }

    clonedNode.versions = CloneUtils.deepClone(this.versions);

    // clone native children
    if (!ignoreProps.includes('children') && !ignoreProps.includes('nativeChildren')) {
      const childPhase = isComponent ? 99 : targetPhase;
      this.nativeChildren.forEach(c => c.clone(ignoreProps, shallowCopyProps, clonedNode, childPhase, false));
    }

    return clonedNode;
  }
}
