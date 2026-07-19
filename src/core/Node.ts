import type { NodeData, NodeQuery, HandlerDef, ComponentBinding, NextState, RollbackState, PlacementConfig } from "../types/NodeSchema.js";
import { StyleNode } from "./StyleNode.js";
import { Supervisor } from "./Supervisor.js";
import { clientAPI } from "./ClientAPI.js";
import { PlacementWorker } from "./workers/PlacementWorker.js";

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
  public compiledHandlers: Record<string, Function> = {};
  public css: { id?: string; classes?: string[]; style?: Record<string, string>; cssDef?: any[] } = {};
  public versions?: any[];

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
      }
      return cloned;
    } catch (e) {
      console.warn("Cycle detected during deepClone, falling back", e);
      return val;
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
              if (compiled) this.compiledHandlers[handlerName] = compiled;
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
    for (const child of this.children) {
      child.clearTrackingArrays();
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
    if (changedKeys.length === 0) return;

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

    const sup: any = (typeof globalThis !== 'undefined' && (globalThis as any).Supervisor) ? (globalThis as any).Supervisor : Supervisor.instance;
    if (sup && sup.getWorkerForPhase) {
      const worker = sup.getWorkerForPhase(targetPhase);
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

  public validate(bubbleErrors: boolean = false): boolean {
    let valid = true;
    if (!this.type) {
      console.error("Node validation failed: missing 'type' property", this.data);
      valid = false;
    } else {
      if (this.component) {
        const typeTargets = this.component.filter(c => c.target === "type");
        if (typeTargets.length > 1) {
          console.error("Node validation failed: node cannot have more than one 'type' target in components", this.data);
          valid = false;
        }
      }
      const requiredProps = Node.REQUIRED_PROPS_MAP[this.type.toLowerCase()];
      if (requiredProps) {
        for (const prop of requiredProps) {
          if (!this.props || !this.props[prop]) {
            console.error(`Node validation failed: '${this.type}' missing required property: '${prop}'`, this.data);
            valid = false;
          }
        }
      }
    }
    for (const sNode of this.styleNodes) {
      if (!sNode.validate()) {
        console.error("Node validation failed: invalid StyleNode in cssDef", sNode.data);
        valid = false;
      }
    }
    for (const child of this.children) {
      if (!child.validate(bubbleErrors) && bubbleErrors) {
        valid = false;
      }
    }
    this.isValid = valid;
    return valid;
  }

  public isMatch(query: NodeQuery | ((node: Node) => boolean)): boolean {
    if (typeof query === 'function') {
      return query(this);
    }

    if (query.id && this.css?.id !== query.id) return false;
    if (query.type && this.type !== query.type) return false;

    if (query.classes && query.classes.length > 0) {
      if (!this.css?.classes) return false;
      const hasAllClasses = query.classes.every(c => this.css!.classes!.includes(c));
      if (!hasAllClasses) return false;
    }

    if (query.props) {
      if (!this.props) return false;
      for (const [k, v] of Object.entries(query.props)) {
        if (this.props[k] !== v) return false;
      }
    }

    if (query.style) {
      if (!this.css?.style) return false;
      for (const [k, v] of Object.entries(query.style)) {
        if (this.css.style[k] !== v) return false;
      }
    }

    if (query.handlers) {
      if (!this.handlers) return false;
      for (const [k, v] of Object.entries(query.handlers)) {
        if (this.handlers[k] !== v) return false;
      }
    }

    if (query.components && query.components.length > 0) {
      if (!this.component) return false;
      for (const compQuery of query.components) {
        const match = this.component.some(c => {
          if (compQuery.target && c.target !== compQuery.target) return false;
          if (compQuery.reference && c.reference !== compQuery.reference) return false;
          return true;
        });
        if (!match) return false;
      }
    }

    return true;
  }

  public findNodes(query: NodeQuery | ((node: Node) => boolean)): Node[] {
    const results: Node[] = [];

    if (this.isMatch(query)) {
      results.push(this);
    }

    for (const child of this.children) {
      results.push(...child.findNodes(query));
    }

    return results;
  }

  public findNode(query: NodeQuery | ((node: Node) => boolean), depth: number = 0): Node | null {
    if (this.isMatch(query)) {
      return this;
    }

    for (const child of this.children) {
      const found = child.findNode(query, depth + 1);
      if (found) return found;
    }

    return null;
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
          fn = this.compiledHandlers[handlerObj.name] || clientAPI.getHandler(handlerObj.name, this);
        } else {
          fn = this.compiledHandlers[phase] || clientAPI.getHandler(phase, this);
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

    if (recursive) {
      for (const child of this.children) {
        child.executeHandlers(phase, context, recursive);
      }
    }
  }

  private compileHandlersMap(handlersObj: Record<string, any>): void {
    for (const [key, value] of Object.entries(handlersObj)) {
      if (value === null) continue;
      const handlerName = typeof value === 'object' && 'name' in value ? (value as any).name : key;
      const handlerBody = typeof value === 'object' && 'body' in value ? (value as any).body : String(value);
      const compiled = clientAPI.compileHandler(handlerName, handlerBody);
      if (compiled) {
        this.compiledHandlers[handlerName] = compiled;
        if (handlerName !== key) this.compiledHandlers[key] = compiled;
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
