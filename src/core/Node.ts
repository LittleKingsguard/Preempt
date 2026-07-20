import type { NodeData, NodeQuery, HandlerDef, ComponentBinding, NextState, RollbackState, PlacementConfig } from "../types/NodeSchema.js";
import { StyleNode } from "./StyleNode.js";
import { Supervisor } from "./Supervisor.js";
import { clientAPI } from "./ClientAPI.js";
import { PlacementWorker } from "./workers/PlacementWorker.js";
import { NodeQueryUtils } from "./utils/NodeQueryUtils.js";

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

  public children: Node[] = [];
  public parent: Node | null = null;
  public element: HTMLElement | null = null;
  public styleNodes: StyleNode[] = [];
  public isValid: boolean = true;

  public type: string = 'div';
  public placement?: PlacementConfig;
  public activePlacement?: string;
  public component?: any[];
  public content?: string | undefined;
  public props: Record<string, any> = {};
  public handlers?: Record<string, string | HandlerDef>;
  public compiledHandlers: Map<string, Function> = new Map();
  public css: { id?: string; classes?: string[]; style?: Record<string, string>; cssDef?: any[] } = {};
  public versions?: any[];
  public lastCompletedPhase?: number;

  public sourceComponents: Map<string, any> = new Map();
  public targetComponents: Map<string, any> = new Map();
  public static placementArray: Node[] = [];
  public static sourcePlacements: Record<string, Node[]> = {};

  public originalParent: Node | null = null;
  public originalIndex: number = -1;
  public wasPlaced: boolean = false;
  public _attachedListeners: { eventName: string, handlerFunc: EventListener }[] = [];

  public static globalMetadata: any = {};

  private static readonly CLONE_IGNORE_KEYS = new Set([
    '_lastValidState', 'element', 'styleNodes', 'node',
    '_instantiatedNodes', '_referencingNodes', 'parent',
    'children', 'originalParent'
  ]);

  private static readonly HASH_IGNORE_KEYS = new Set([
    'node', 'css', '_instantiatedNodes', '_referencingNodes',
    'parent', 'children', 'originalParent'
  ]);

  public static deepClone(val: any, shallowKeys: string[] = [], ignoreKeys: Iterable<string> = Node.CLONE_IGNORE_KEYS): any {
    if (val === undefined) return undefined;
    const seen = new WeakSet();
    const ignoreSet = ignoreKeys instanceof Set ? ignoreKeys : new Set(ignoreKeys);
    const replacer = (k: string, v: any) => {
      if (shallowKeys.includes(k)) return undefined;
      
      if (ignoreSet.has(k)) return undefined;
      
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined; // Prevent cycle
        seen.add(v);
      }
      return v;
    };
    try {
      const cloned = JSON.parse(JSON.stringify(val, replacer));
      if (val !== null && typeof val === 'object' && cloned !== null && typeof cloned === 'object') {
        for (const key of shallowKeys) {
          if (key in val) cloned[key] = val[key];
        }
        const ignoreSet = ignoreKeys instanceof Set ? ignoreKeys : new Set(ignoreKeys);
        const childrenDeepCloned = !ignoreSet.has('children') && !shallowKeys.includes('children');
        const instNodesDeepCloned = !ignoreSet.has('_instantiatedNodes') && !shallowKeys.includes('_instantiatedNodes');

        const runRestore = (original: any, copy: any) => {
          if (original instanceof Node) {
            Node.restorePrototypesAndParents(copy, copy.parent || null, childrenDeepCloned, instNodesDeepCloned);
          } else if (Array.isArray(original) && Array.isArray(copy)) {
            for (let i = 0; i < original.length; i++) {
              runRestore(original[i], copy[i]);
            }
          }
        };

        runRestore(val, cloned);
      }
      return cloned;
    } catch (e) {
      console.warn("Cycle detected during deepClone, falling back", e);
      return val;
    }
  }

  public static restorePrototypesAndParents(node: any, parent: Node | null = null, restoreChildren: boolean = true, restoreInstantiated: boolean = true): void {
    Object.setPrototypeOf(node, Node.prototype);
    node.parent = parent;
    
    if (node.compiledHandlers && !(node.compiledHandlers instanceof Map)) {
      node.compiledHandlers = new Map();
    }
    
    if (node.handlers) {
      node.compileHandlersMap(node.handlers);
    }
    
    if (node.sourceComponents && !(node.sourceComponents instanceof Map)) {
      const plainObj = node.sourceComponents;
      node.sourceComponents = new Map();
      for (const key of Object.keys(plainObj)) {
        node.sourceComponents.set(key, plainObj[key]);
      }
    }
    if (node.targetComponents && !(node.targetComponents instanceof Map)) {
      const plainObj = node.targetComponents;
      node.targetComponents = new Map();
      for (const key of Object.keys(plainObj)) {
        node.targetComponents.set(key, plainObj[key]);
      }
    }

    if (restoreChildren && node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) {
          Node.restorePrototypesAndParents(child, node as Node, restoreChildren, restoreInstantiated);
        }
      }
    }
    if (restoreInstantiated && node._instantiatedNodes && Array.isArray(node._instantiatedNodes)) {
      for (const instNode of node._instantiatedNodes) {
        if (instNode) {
          Node.restorePrototypesAndParents(instNode, node as Node, restoreChildren, restoreInstantiated);
        }
      }
    }
  }
  public static idCollisions = new Map<string, number>();

  public static generateObjectHash(obj: any): string {
    const replacer = (k: string, v: any) => {
      if (Node.HASH_IGNORE_KEYS.has(k)) return undefined;
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
      let filtered = components.filter(c => c !== null);
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
              const compiled = clientAPI.compileHandler(handlerName, (binding.value as any).body);
              if (compiled) this.compiledHandlers.set(handlerName, compiled);
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

  constructor(data: NodeData, parent: Node | null = null) {
    this.data = data;
    this.parent = parent;
    this.resolveVersion();

    this.props = Node.deepClone(this.data.props) || {};
    this.css = Node.deepClone(this.data.css) || {};
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

    if (data.css && data.css.cssDef) {
      for (const def of data.css.cssDef) {
        this.styleNodes.push(new StyleNode(def, this));
      }
    }



    if (this.data.type !== undefined) this.type = this.data.type;
    else this.type = 'div';

    if (typeof this.data.content === "string") {
      this.content = this.data.content;
    }

    this.handlers = Node.deepClone(this.data.handlers);
    if (this.handlers === undefined) {
      delete this.handlers;
    } else {
      this.compileHandlersMap(this.handlers);
    }

    this.setComponents(Node.deepClone(this.data.component));


    this.placement = Node.deepClone(this.data.placement);
    if (this.placement === undefined) delete this.placement;

    this.versions = Node.deepClone(this.data.versions);
    if (this.versions === undefined) delete this.versions;

    this.resolveVersion();

    PlacementWorker.appendPlacement(this);
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
      this.placement._referencingNodes = [];
    }
    if (this.component) {
      for (const c of this.component) {
        if (c._referencingNodes) c._referencingNodes = [];
      }
    }
    if (this.children && Array.isArray(this.children)) {
      for (const child of this.children) {
        if (child) child.clearTrackingArrays();
      }
    }
  }



  // Removed applyComponents and applyComponentsTree to align with purely reactive data container spec






  public delete(): void {
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index > -1) {
        this.parent.children.splice(index, 1);
      }
    }
    
    let queuedNodes: Node[] = [];

    const pIndex = Node.placementArray.indexOf(this);
    if (pIndex > -1) {
      Node.placementArray.splice(pIndex, 1);
      if (this.placement?.placementName) {
        const oldPlacement = this.placement.placementName;
        const referencingNodes = Node.sourcePlacements[oldPlacement] || [];
        queuedNodes = [...referencingNodes];
        for (const ref of referencingNodes) {
          ref.receiveNextState({ activePlacement: undefined }, 1);
        }
      }
    }

    // Recursively delete children
    while (this.children.length > 0) {
      const child = this.children.pop();
      if (child) {
        if (queuedNodes.includes(child)) {
          continue;
        }
        child.delete();
      }
    }
    for (const key of Object.keys(Node.sourcePlacements)) {
      if (Array.isArray((Node.sourcePlacements as any)[key])) {
        const arr = (Node.sourcePlacements as any)[key];
        const sIndex = arr.indexOf(this);
        if (sIndex > -1) arr.splice(sIndex, 1);
        if (arr.length === 0) delete (Node.sourcePlacements as any)[key];
      }
    }
    for (const sNode of this.styleNodes) {
      sNode.delete();
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
      this._lastValidState = Node.deepClone(this, ['content', 'children']);
    }

    if (nextState.handlers) {
      this.compileHandlersMap(nextState.handlers);
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

  public static clearPlacements(): void {
    Node.placementArray = [];
    Node.sourcePlacements = {};
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
    if (this.handlers && this.handlers[phase]) {
      try {
        const handlerObj = this.handlers[phase] as any;
        const fullContext = { 
          ...context, 
          node: this, 
          metadata: Node.globalMetadata, 
          rootNode: Supervisor.getRootNode(), 
          contentPayload: Supervisor.instance?.contentData || [], 
          clientAPI 
        };

        let fn: Function | undefined;
        if (typeof handlerObj === 'object' && handlerObj !== null && 'name' in handlerObj) {
          fn = this.compiledHandlers.get(handlerObj.name);
          if (!fn && 'body' in handlerObj) {
            fn = clientAPI.compileHandler(handlerObj.name, handlerObj.body);
            if (fn) {
              this.compiledHandlers.set(handlerObj.name, fn);
              this.compiledHandlers.set(phase, fn);
            }
          }
          if (!fn) fn = clientAPI.getHandler(handlerObj.name, this);
        } else if (typeof handlerObj === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(handlerObj)) {
          fn = this.compiledHandlers.get(handlerObj) || clientAPI.getHandler(handlerObj, this);
        } else {
          fn = this.compiledHandlers.get(phase) || clientAPI.getHandler(phase, this);
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

    if (recursive && this.children && Array.isArray(this.children)) {
      for (const child of this.children) {
        if (child) {
          child.executeHandlers(phase, context, recursive);
        }
      }
    }
  }

  private compileHandlersMap(handlersObj: Record<string, any>): void {
    for (const [key, value] of Object.entries(handlersObj)) {
      if (value === null) continue;
      if (typeof value === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value)) continue;
      const handlerName = typeof value === 'object' && 'name' in value ? (value as any).name : key;
      const handlerBody = typeof value === 'object' && 'body' in value ? (value as any).body : String(value);
      const compiled = clientAPI.compileHandler(handlerName, handlerBody);
      if (compiled) {
        this.compiledHandlers.set(handlerName, compiled);
        if (handlerName !== key) this.compiledHandlers.set(key, compiled);
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
}
