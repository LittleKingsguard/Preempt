import type { NodeData, NodeQuery, ComponentBinding, NextState, RollbackState } from "../types/NodeSchema.js";
import { StyleNode } from "./StyleNode.js";
import { Supervisor } from "./Supervisor.js";
import { clientAPI } from "./ClientAPI.js";
import { PlacementWorker } from "./workers/PlacementWorker.js";
import { NodeQueryUtils } from "./utils/NodeQueryUtils.js";
import { Component } from "./Component.js";
import { Handler } from "./Handler.js";
import { Css } from "./Css.js";
import { Placement } from "./Placement.js";

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

  public data: NodeData;
  public _lastValidState?: RollbackState;

  public nativeChildren: Node[] = [];
  private _childrenCache: Node[] | null = null;
  public parent?: Node | null;
  public element: HTMLElement | null = null;

  public isValid: boolean = true;

  public get children(): Node[] {
    if (this._childrenCache) return this._childrenCache;
    let placedChildren: Node[] = [];
    if (this.placement && this.placement._referencingNodes) { //TODO: Expand placement to array of placements
      placedChildren = Array.from(this.placement._referencingNodes);
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
  public placement?: Placement;
  public activePlacement?: string;
  public component?: Component[];
  public content?: string | any;
  public props: Record<string, any> = {};
  public handlers?: Record<string, Handler>;
  public css: Css = new Css();
  public versions?: any[];
  public lastCompletedPhase?: number;

  public sourceComponents: Map<string, Component> = new Map();
  public targetComponents: Map<string, Component> = new Map();

  public originalParent: Node | null = null;
  public originalIndex: number = -1;
  public wasPlaced: boolean = false;
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

  public setComponents(components: ComponentBinding[] | undefined): void {
    if (components === undefined) {
      delete this.component;
    } else {
      let filtered = components.filter(c => c !== null).map(c => c instanceof Component ? (c.parent = this, c) : new Component(c, this));
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
        for (const binding of this.sourceComponents.values()) {
          if (typeof binding.value === "object" && binding.value !== null) {
            if ('body' in binding.value) {
              const handlerName = (binding.value as any).name || binding.reference;
              if (!this.handlers) this.handlers = {};
              if (!this.handlers[handlerName]) {
                this.handlers[handlerName] = new Handler({ name: handlerName, body: (binding.value as any).body });
              } else {
                this.handlers[handlerName].body = (binding.value as any).body;
              }
            } else {
              binding._instantiatedNodes = [];
            }
          }
        }
      } else {
        delete this.component;
      }
    }
  }

  constructor(data: NodeData, parent?: Node | null) {
    this.data = data;
    this.parent = parent;
    this.resolveVersion();

    this.props = CloneUtils.deepClone(this.data.props) || {};
    this.css = new Css(this.data.css || {}, this);
    if (!this.css.id) {
      this.css.id = this.props.id || Node.generateObjectHash(this.data);
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





    if (this.data.type !== undefined) this.type = this.data.type;
    else this.type = 'div';

    if (this.data.content !== undefined) {
      this.content = this.data.content as string;
    }

    if (this.data.handlers) {
      this.handlers = {};
      for (const [k, v] of Object.entries(this.data.handlers)) {
        this.handlers[k] = new Handler(v, k);
      }
    }

    this.setComponents(CloneUtils.deepClone(this.data.component));


    this.placement = this.data.placement ? new Placement(this.data.placement, this) : undefined;

    this.versions = CloneUtils.deepClone(this.data.versions);
    if (this.versions === undefined) delete this.versions;

    this.resolveVersion();
  }

  private resolveVersion(): void {
    const targetVersion = this.props?.version || Node.globalMetadata?.version;
    if (!targetVersion || typeof targetVersion.timestamp !== 'number' || !this.versions || this.versions.length === 0) {
      return;
    }

    const targetTimestamp = targetVersion.timestamp;

    const sortedVersions = [...this.versions].sort((a, b) => b.timestamp - a.timestamp);
    const matchedVersion = sortedVersions.find(v => v.timestamp <= targetTimestamp);

    if (matchedVersion) {
      if (matchedVersion.content !== undefined) {
        this.content = matchedVersion.content;
      }
      if (matchedVersion.props !== undefined) {
        this.props = matchedVersion.props;
      }
      if (matchedVersion.component !== undefined) {
        this.setComponents(matchedVersion.component);
      }
      if (matchedVersion.css !== undefined) {
        this.css = matchedVersion.css;
      }
    }
  }

  public clearTrackingArrays(): void {
    if (this.placement && this.placement._referencingNodes) {
      this.placement._referencingNodes = new Set();
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

    if (this.placement instanceof Placement) {
      this.placement.delete();
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
    
    if (this.component) {
      for (const c of this.component) {
        if (c && c.delete) {
          c.delete();
        }
      }
    }
    
    if (this.handlers) {
      for (const h of Object.values(this.handlers)) {
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
        if (Supervisor.instance && Supervisor.instance.activeLockedPhases && Supervisor.instance.activeLockedPhases.has(explicitPhaseId)) {
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
      if (Supervisor.instance && Supervisor.instance.activeLockedPhases && Supervisor.instance.activeLockedPhases.has(explicitPhaseId)) {
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

    // Snapshot state
    if (!this._lastValidState) {
      this._lastValidState = CloneUtils.deepClone(this, ['content', 'children']);
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
      Object.assign(this.data, stateToRestore);
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

  public executeHandlers(phase: string, context: any, recursive: boolean = true): void {
    if (this.handlers) {
      for (const handler of Object.values(this.handlers)) {
        if (handler.phase === phase || (!handler.phase && !handler.event && handler.name === phase)) {
          try {
            const fullContext = {
              ...context,
              node: this,
              metadata: Node.globalMetadata,
              rootNode: Supervisor.getRootNode(),
              contentPayload: Supervisor.instance?.contentData || [],
              clientAPI
            };
            
            let fn = handler.compiled || clientAPI.getHandler(handler.name, this);
            if (!fn) {
              fn = clientAPI.getHandler(phase, this);
            }

            if (fn) {
              let result: any;
              if (fn.length === 1) {
                result = fn(fullContext);
              } else {
                result = fn(null, fullContext);
              }
              if (result && typeof result.catch === 'function') {
                result.catch((err: any) => {
                  console.error(`Failed to execute async ${phase} handler on node:`, err);
                });
              }
            }
          } catch (err) {
            console.error(`Failed to execute ${phase} handler on node:`, err);
          }
        }
      }
    }

    if (recursive && this.children && Array.isArray(this.children)) {
      for (const child of this.children) {
        if (child) {
          child.executeHandlers(phase, context, recursive);
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

  public clone(ignoreProps: string[] = [], shallowCopyProps: string[] = []): Node {
    const clonedData = CloneUtils.deepClone(this.data);
    const clonedNode = new Node(clonedData);

    clonedNode.type = this.type;
    clonedNode.activePlacement = this.activePlacement;

    if (!ignoreProps.includes('css')) {
      clonedNode.css = this.css ? this.css.clone(ignoreProps, clonedNode) : new Css({}, clonedNode);
    }
    if (!ignoreProps.includes('placement')) {
      clonedNode.placement = this.placement ? this.placement.clone(ignoreProps, clonedNode) : undefined;
    }
    if (!ignoreProps.includes('content')) {
      clonedNode.content = this.content ? this.content : undefined;
    }
    if (!ignoreProps.includes('props')) {
      clonedNode.props = CloneUtils.deepClone(this.props);
    }
    if (!ignoreProps.includes('handlers')) {
      if (this.handlers) {
        clonedNode.handlers = {};
        for (const [k, v] of Object.entries(this.handlers)) {
          clonedNode.handlers[k] = v.clone();
        }
      }
    }
    if (!ignoreProps.includes('component')) {
      if (this.component) {
        clonedNode.component = this.component.map(c => c.clone(ignoreProps, clonedNode));
      }
    }

    clonedNode.versions = CloneUtils.deepClone(this.versions);

    // clone native children
    if (!ignoreProps.includes('children') && !ignoreProps.includes('nativeChildren')) {
      clonedNode.nativeChildren = this.nativeChildren.map(c => {
        const clonedChild = c.clone(ignoreProps, shallowCopyProps);
        clonedChild.parent = clonedNode;
        return clonedChild;
      });
      clonedNode.invalidateChildrenCache();
    }

    return clonedNode;
  }
}
