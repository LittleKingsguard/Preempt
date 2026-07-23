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

export class Node {
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

  public get data(): NodeData {
    return this._data;
  }

  public set data(_val: NodeData) {
    console.error("[Node] Error: 'data' property is read-only and cannot be mutated or reassigned.");
  }

  public _lastValidState?: RollbackState;

  public nativeChildren: Node[] = [];
  private _childrenCache: Node[] | null = null;
  public parent?: Node | null;
  public element: HTMLElement | null = null;

  public isValid: boolean = true;

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

  public invalidateChildrenCache(): void {
    this._childrenCache = null;
    if (this.parent) this.parent.invalidateChildrenCache();
  }

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
            console.error(`Duplicate target component defined for target: ${c.target}`);
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

  constructor(data: NodeData, parent: Node | null | undefined, phase: number, isInTree: boolean = false) {
    this._data = data;
    this.parent = parent;
    this.isInTree = isInTree;

    this.props = new Props(this._data.props || {}, this);
    this.css = new Css(this._data.css || {}, this);
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

    if ((phase === 0 || phase === 99) && this._data.children && Array.isArray(this._data.children)) {
      for (const childData of this._data.children) {
        const childNode = new Node(childData, this, phase, this.isInTree);
        this.nativeChildren.push(childNode);
      }
    }

    if (this._data.handlers) {
      this.handlers = this._data.handlers.map(h => new Handler(h, this, phase));
    } else {
      this.handlers = [];
    }

    this.setComponents(this._data.component, phase);

    if (this._data.placement) {
      this.placement = this._data.placement.map((p: any) => new Placement(p, this, phase, this.isInTree));
    } else {
      this.placement = [];
    }

    if (this.isInTree && phase <= 5) {
      Supervisor.emitToPhase(this, this, {}, 5); // Emit to Phase 5: ValidationWorker
    }
  }

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

  public receiveNextState(nextState: NextState, explicitPhaseId?: number): void {
    const changedKeys = Object.keys(nextState);
    if (changedKeys.length === 0) {
      if (explicitPhaseId !== undefined) {
        if (Supervisor.isPhaseLocked(explicitPhaseId)) {
          console.error(`[Node] Lock violation: Phase ${explicitPhaseId} is already locked for node ${this.css?.id}`);
          return;
        }
        if (Supervisor.instance && Supervisor.instance.getWorkerForPhase) {
          const worker = Supervisor.instance.getWorkerForPhase(explicitPhaseId);
          if (worker) worker.push(this, this._lastValidState);
        }
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

    if (nextState.component !== undefined) {
      const oldComponents = this.component || [];
      const newComponents = nextState.component || [];

      let sourceChanged = false;
      const oldSource = oldComponents.filter(c => c.value !== undefined);
      const newSource = newComponents.filter(c => c.value !== undefined);

      if (oldSource.length !== newSource.length) {
        sourceChanged = true;
      } else {
        for (const oldC of oldSource) {
          const newC = newSource.find(c => c.reference === oldC.reference);
          if (!newC || newC.target !== oldC.target || Node.generateObjectHash(newC.value) !== Node.generateObjectHash(oldC.value)) {
            sourceChanged = true;
            break;
          }
        }
      }

      if (sourceChanged) {
        console.error(`[Node] receiveNextState rejected: Cannot modify source components via receiveNextState. Please update the node.data state and pass the layout change to Supervisor/InstantiationWorker so the node tree can be properly rebuilt. Node ID: ${this.css?.id}`);
        return;
      }
    }

    let targetPhase = 5; // default to Validation
    if (explicitPhaseId !== undefined) {
      if (Supervisor.isPhaseLocked(explicitPhaseId)) {
        console.error(`[Node] Lock violation: Phase ${explicitPhaseId} is already locked for node ${this.css?.id}`);
        return;
      }
      targetPhase = explicitPhaseId;
    } else {
      for (const key of changedKeys) {
        if (Supervisor.isPropertyLocked(key)) {
          console.error(`[Node] Lock violation: Property '${key}' is currently locked by another phase for node ${this.css?.id}`);
          return;
        }
        const pId = Supervisor.propertyToPhaseMap ? Supervisor.propertyToPhaseMap[key] : 5;
        if (pId !== undefined && pId < targetPhase) {
          targetPhase = pId;
        }
      }
    }

    if (targetPhase <= 2) {
      for (const comp of this.targetComponents.values()) {
        if (comp.rollback !== undefined) {
          Object.assign(this, comp.rollback);
        }
      }
    } else if (targetPhase === 3) {
      for (const comp of this.targetComponents.values()) {
        if (comp.target !== "type" && comp.rollback !== undefined) {
          Object.assign(this, comp.rollback);
        }
      }
    }

    // Snapshot state
    if (!this._lastValidState) {
      this._lastValidState = this.clone(['content', 'children', 'nativeChildren', '_childrenCache', 'parent', 'element'], [], null, 99);
      this._lastValidState.nativeChildren = [...this.nativeChildren];
    }

    // Apply optimistically
    const mergeDeep = (target: any, source: any) => {
      for (const key in source) {
        if (source[key] instanceof Object && !Array.isArray(source[key]) && source[key] !== null) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          mergeDeep(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    };
    mergeDeep(this.data, nextState);
    Object.assign(this, nextState);

    if (Supervisor.instance && Supervisor.instance.getWorkerForPhase) {
      const worker = Supervisor.instance.getWorkerForPhase(targetPhase);
      if (worker) worker.push(this, this._lastValidState);
    }
  }

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

  public isMatch(query: NodeQuery | ((node: Node) => boolean)): boolean {
    return NodeQueryUtils.isMatch(this, query);
  }

  public findNodes(query: NodeQuery | ((node: Node) => boolean)): Node[] {
    return NodeQueryUtils.findNodes(this, query);
  }

  public findNode(query: NodeQuery | ((node: Node) => boolean), depth: number = 0): Node | null {
    return NodeQueryUtils.findNode(this, query, depth);
  }

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

  public exportToJson(): NodeData {
    const cleanData = (data: any) => {
      if (!data) return data;
      const d = { ...data };
      if (d.node) delete d.node;
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
      if (d.component) {
        // TODO: Architectural leak. Core code should not contain hardcoded references 
        // to specific components like "PreemptEditor". This filtering logic should 
        // be moved to the editor module or handled via a generalized exclude flag.
        const editorIndex = d.component.findIndex((c: any) => c.reference === "PreemptEditor");
        if (editorIndex !== -1) {
          d.component = [...d.component];
          d.component.splice(editorIndex, 1);
          if (d.component.length === 0) delete d.component;
        }
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

  public clone(ignoreProps: string[] = [], shallowCopyProps: string[] = [], newParent: Node | null, phase: number): Node {
    const clonedData = this.data;
    const targetPhase = phase;
    let targetIsInTree = false;
    if (newParent === null) {
      targetIsInTree = true;
    } else {
      targetIsInTree = newParent.isInTree;
    }
    const clonedNode = new Node(clonedData, newParent, targetPhase, targetIsInTree);

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
      clonedNode.props = this.props ? this.props.clone(ignoreProps, clonedNode) : new Props({}, clonedNode);
    }
    if (!ignoreProps.includes('handlers')) {
      if (this.handlers && Array.isArray(this.handlers)) {
        clonedNode.handlers = this.handlers.map(h => h.clone(clonedNode, targetPhase));
      }
    }
    if (!ignoreProps.includes('component')) {
      if (this.component) {
        clonedNode.component = this.component.map(c => c.clone(ignoreProps, clonedNode, targetPhase));
      }
    }

    clonedNode.versions = CloneUtils.deepClone(this.versions);

    // clone native children
    if (!ignoreProps.includes('children') && !ignoreProps.includes('nativeChildren')) {
      clonedNode.nativeChildren = this.nativeChildren.map(c => c.clone(ignoreProps, shallowCopyProps, clonedNode, targetPhase));
      clonedNode.invalidateChildrenCache();
    }

    return clonedNode;
  }
}
