import type { NodeData, NodeQuery } from "../types/NodeSchema.js";
import { StyleNode } from "./StyleNode.js";
import { Supervisor } from "./Supervisor.js";
import { clientAPI } from "./ClientAPI.js";

export class Node {
  private static readonly REQUIRED_PROPS_MAP: Record<string, string[]> = {
    "img": ["src", "alt"],
    "a": ["href"],
    "iframe": ["src"],
    "form": ["action"],
    "video": ["src"],
    "audio": ["src"],
    "source": ["src"]
  };

  public data: NodeData;

  public children: Node[] = [];
  public parent: Node | null = null;
  public element: HTMLElement | null = null;
  public styleNodes: StyleNode[] = [];
  public isValid: boolean = true;
  public isComponentInjected: boolean = false;
  private _hasChangedSinceRender: boolean = true;
  public get hasChangedSinceRender(): boolean {
    return this._hasChangedSinceRender;
  }
  public set hasChangedSinceRender(value: boolean) {
    this._hasChangedSinceRender = value;
    if (value) {
      if (this.placement && this.placement._referencingNodes) {
        for (const ref of this.placement._referencingNodes) {
          if (!ref.hasChangedSinceRender) ref.hasChangedSinceRender = true;
        }
      }
      if (this.component) {
        for (const comp of this.component) {
          if (comp._referencingNodes) {
            for (const ref of comp._referencingNodes) {
              if (!ref.hasChangedSinceRender) ref.hasChangedSinceRender = true;
            }
          }
        }
      }
    }
  }

  public type: string = 'div';
  public placement?: any;
  public component?: any[];
  public content?: string | undefined;
  public props: Record<string, any> = {};
  public handlers?: Record<string, string>;
  public css: { id?: string; classes?: string[]; style?: Record<string, string>; cssDef?: any[] } = {};
  public versions?: any[];

  public static placementArray: Node[] = [];
  public static sourcePlacements: Node[] = [];
  public originalParent: Node | null = null;
  public originalIndex: number = -1;

  public static globalMetadata: any = {};

  constructor(data: NodeData, parent: Node | null = null, isComponentInjected: boolean = false) {
    this.data = data;
    Object.defineProperty(this.data, 'node', { value: this, enumerable: false, configurable: true, writable: true });
    this.parent = parent;
    this.isComponentInjected = isComponentInjected;

    this.resolveVersion();

    if (!this.data.css) this.data.css = {};
    if (!this.data.css.id) this.data.css.id = `preempt-node-${Math.random().toString(36).substring(2, 10)}`;
    if (!this.data.props) this.data.props = {};

    if (typeof window !== 'undefined') {
      const existingEl = document.getElementById(this.data.css.id);
      if (existingEl) {
        this.element = existingEl;
      }
    }

    if (data.css && data.css.cssDef) {
      for (const def of data.css.cssDef) {
        this.styleNodes.push(new StyleNode(def, this));
      }
    }

    if (data.content) {
      if (Array.isArray(data.content)) {
        data.content.forEach(childData => {
          this.children.push(new Node(childData, this));
        });
      } else if (typeof data.content === "object" && data.content !== null) {
        this.children.push(new Node(data.content, this));
      }
    }

    const deepClone = (val: any) => {
      if (val === undefined) return undefined;
      const replacer = (k: string, v: any) => k === 'node' ? undefined : v;
      return JSON.parse(JSON.stringify(val, replacer));
    };

    if (this.data.type !== undefined) this.type = this.data.type;
    else this.type = 'div';

    if (typeof this.data.content === "string") {
      this.content = this.data.content;
    }

    this.css = deepClone(this.data.css) || {};
    this.props = deepClone(this.data.props) || {};

    this.handlers = deepClone(this.data.handlers);
    if (this.handlers === undefined) delete this.handlers;

    this.component = deepClone(this.data.component);
    if (this.component === undefined) delete this.component;

    this.placement = deepClone(this.data.placement);
    if (this.placement === undefined) delete this.placement;

    this.versions = deepClone(this.data.versions);
    if (this.versions === undefined) delete this.versions;

    this.resolveVersion();
    Node.appendPlacement(this);
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
        this.component = matchedVersion.component;
      }
      if (matchedVersion.css !== undefined) {
        this.css = matchedVersion.css;
      }
    }
  }

  public applyComponentsTree(): void {
    this.applyComponents();
    for (const child of this.children) {
      child.applyComponentsTree();
    }
  }

  private applyComponents(processedComponents: Set<any> = new Set()): void {
    if (!this.component) return;

    const componentsToProcess = this.component.filter(c => !processedComponents.has(c));
    if (componentsToProcess.length === 0) return;

    const sortedComponents = [...componentsToProcess].sort((a, b) => {
      if (a.target === "type" && b.target !== "type") return -1;
      if (a.target !== "type" && b.target === "type") return 1;
      return 0;
    });

    let addedNew = false;

    for (const binding of sortedComponents) {
      processedComponents.add(binding);
      if (!binding.target) continue;

      let resolvedValue: string | NodeData | NodeData[] | null = binding.value !== undefined ? binding.value : null;

      if (resolvedValue !== null) {
        if (!binding._referencingNodes) binding._referencingNodes = [];
        if (!binding._referencingNodes.includes(this)) {
          binding._referencingNodes.push(this);
        }
      }

      if (resolvedValue === null) {
        let currentParent = this.parent;
        while (currentParent) {
          const parentBinding = currentParent.component?.find(b => b.reference === binding.reference && b.value !== null && b.value !== undefined);
          if (parentBinding) {
            resolvedValue = parentBinding.value !== undefined ? parentBinding.value : null;
            if (!parentBinding._referencingNodes) parentBinding._referencingNodes = [];
            if (!parentBinding._referencingNodes.includes(this)) {
              parentBinding._referencingNodes.push(this);
            }
            break;
          }
          currentParent = currentParent.parent;
        }
      }

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${binding.reference}' targeting '${binding.target}'`);
        continue;
      }

      this.hasChangedSinceRender = true;

      if (binding.target === "type") {
        const dataArray = Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];
        for (const d of dataArray) {
          if (typeof d === "string") {
            this.type = d;
            continue;
          }

          if (d.type) this.type = d.type;

          if (d.content) {
            if (Array.isArray(d.content)) {
              d.content.forEach(childData => {
                this.children.push(new Node(childData, this, true));
              });
            } else if (typeof d.content === "object" && d.content !== null) {
              this.children.push(new Node(d.content, this, true));
            } else if (typeof d.content === "string") {
              if (this.content !== undefined) {
                this.content += d.content;
              } else {
                this.content = d.content;
              }
            }
          }

          if (d.css) {
            if (!this.css) this.css = {};
            if (d.css.style) this.css.style = { ...this.css.style, ...d.css.style };
            if (d.css.classes) this.css.classes = [...new Set([...(this.css.classes || []), ...d.css.classes])];
            if (d.css.cssDef) {
              this.css.cssDef = [...(this.css.cssDef || []), ...d.css.cssDef];
              for (const def of d.css.cssDef) {
                this.styleNodes.push(new StyleNode(def, this, true));
              }
            }
          }

          if (d.props) this.props = { ...this.props, ...d.props };
          if (d.handlers) this.handlers = { ...this.handlers, ...d.handlers };
          if (d.component) {
            this.component = [...(this.component || []), ...d.component];
            addedNew = true;
            // Store reference to component used for seeding
            // Removed preInjectionState
          }
        }
        continue;
      }

      if (typeof resolvedValue === "string") {
        this.applyProperty(binding.target, resolvedValue);
      } else if (binding.target === "content") {
        if (Array.isArray(resolvedValue)) {
          this.content = undefined;
          this.children = (resolvedValue as NodeData[]).map(d => new Node(d as NodeData, this, true));
        } else if (typeof resolvedValue === "object" && resolvedValue !== null) {
          this.content = undefined;
          this.children = [new Node(resolvedValue as NodeData, this, true)];
        } else {
          this.content = String(resolvedValue);
          this.children = [];
        }
        addedNew = true;
      } else {
        console.warn(`Target ${binding.target} expected string value but received object for reference ${binding.reference}`);
      }
    }

    if (addedNew) {
      this.applyComponents(processedComponents);
    }
  }


  private applyProperty(path: string, value: string): void {
    this.hasChangedSinceRender = true;
    if (path === "content") {
      this.content = value;
    } else if (path.startsWith("props.")) {
      const propName = path.substring(6);
      if (!this.props) this.props = {};
      this.props[propName] = value;
    } else if (path.startsWith("handlers.")) {
      const handlerName = path.substring(9);
      if (!this.handlers) this.handlers = {};
      this.handlers[handlerName] = value;
    } else if (path.startsWith("css.style.")) {
      const styleName = path.substring(10);
      if (!this.css) this.css = {};
      if (!this.css.style) this.css.style = {};
      this.css.style[styleName] = value;
    }
  }

  public static appendPlacement(node: Node): void {
    if (node.placement?.placementName) {
      Node.placementArray.push(node);
    }
    if (node.placement?.targetPlacement) {
      Node.sourcePlacements.push(node);
    }
  }

  public static clearPlacements(): void {
    Node.placementArray = [];
    Node.sourcePlacements = [];
  }

  public placeInto(target: Node): void {
    if (target === this) {
      throw new Error("Cannot place node into itself");
    }
    let current: Node | null = target.parent;
    while (current) {
      if (current === this) {
        throw new Error("Cannot place node into a descendant");
      }
      current = current.parent;
    }

    if (this.parent) {
      this.parent.hasChangedSinceRender = true;
      this.originalParent = this.parent;
      this.originalIndex = this.parent.children.indexOf(this);
      if (this.originalIndex > -1) {
        this.parent.children.splice(this.originalIndex, 1);
      }
    }
    this.parent = target;
    target.hasChangedSinceRender = true;
    target.children.push(this);

    if (target.placement) {
      if (!target.placement._referencingNodes) target.placement._referencingNodes = [];
      if (!target.placement._referencingNodes.includes(this)) {
        target.placement._referencingNodes.push(this);
      }
    }

    console.log("This node was placed", target, target.parent);
  }

  public restorePlacement(): void {
    if (this.originalParent && this.originalIndex > -1) {
      if (this.parent) {
        this.parent.hasChangedSinceRender = true;
        const index = this.parent.children.indexOf(this);
        if (index > -1) {
          this.parent.children.splice(index, 1);
        }
        if (this.parent.placement && this.parent.placement._referencingNodes) {
          const refIndex = this.parent.placement._referencingNodes.indexOf(this);
          if (refIndex > -1) {
            this.parent.placement._referencingNodes.splice(refIndex, 1);
          }
        }
      }
      this.parent = this.originalParent;
      this.parent.hasChangedSinceRender = true;
      this.parent.children.splice(this.originalIndex, 0, this);
      this.originalParent = null;
      this.originalIndex = -1;
    }
  }

  public renderToString(): string {
    if (!this.isValid) return "";

    const tag = this.type || "div";
    let attributes = "";

    if (this.props) {
      for (const [key, value] of Object.entries(this.props)) {
        const escapedValue = String(value).replace(/"/g, '&quot;');
        attributes += ` ${key}="${escapedValue}"`;
      }
    }

    if (this.handlers) {
      for (const [key, value] of Object.entries(this.handlers)) {
        const eventName = key.startsWith('on') ? key.toLowerCase() : `on${key.toLowerCase()}`;
        const trimmedValue = String(value).trim();
        let jsCode = trimmedValue;
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          jsCode = `(${trimmedValue})(event, { node: null, metadata: null, rootNode: null })`;
        }
        const escapedValue = jsCode.replace(/"/g, '&quot;');
        attributes += ` ${eventName}="${escapedValue}"`;
      }
    }

    if (this.css) {
      if (this.css.id) attributes += ` id="${this.css.id}"`;
      if (this.css.classes && this.css.classes.length > 0) {
        attributes += ` class="${this.css.classes.join(" ")}"`;
      }
      if (this.css.style) {
        const styleStr = Object.entries(this.css.style)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v}`)
          .join("; ");
        if (styleStr) attributes += ` style="${styleStr}"`;
      }
    }

    let innerHTML = "";
    if (this.content !== undefined) {
      innerHTML += this.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    for (const child of this.children) {
      innerHTML += child.renderToString();
    }

    const voidElements = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
    if (voidElements.includes(tag.toLowerCase())) {
      return `<${tag}${attributes}>`;
    }

    return `<${tag}${attributes}>${innerHTML}</${tag}>`;
  }

  public render(): HTMLElement | null {
    const oldElement = this.element;

    if (!this.isValid) {
      if (oldElement) {
        oldElement.remove();
        this.element = null;
      }
      return null;
    }

    if (!this.hasChangedSinceRender && oldElement) {
      for (const child of this.children) {
        child.render();
      }
      return oldElement;
    }

    const targetTag = (this.type || "div").toLowerCase();
    const shouldReuse = oldElement && oldElement.tagName.toLowerCase() === targetTag;
    const el = shouldReuse ? oldElement! : document.createElement(targetTag);
    this.element = el;

    if (this.props) {
      for (const [key, value] of Object.entries(this.props)) {
        el.setAttribute(key, String(value));
      }
    }

    if (this.handlers) {
      for (const [key, value] of Object.entries(this.handlers)) {
        try {
          let handlerFunc: EventListener;
          const trimmedValue = String(value).trim();
          const context = { node: this, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI };
          if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
            const fn = new Function('return ' + trimmedValue)();
            handlerFunc = ((event: Event) => fn(event, context)) as EventListener;
          } else {
            const fn = new Function('event', 'context', trimmedValue);
            handlerFunc = ((event: Event) => fn(event, context)) as EventListener;
          }
          const eventName = key.startsWith('on') ? key.substring(2).toLowerCase() : key.toLowerCase();
          el.addEventListener(eventName, handlerFunc);
        } catch (err) {
          console.error(`Failed to parse handler for event ${key}:`, err);
        }
      }
    }

    if (this.css) {
      if (this.css.id) el.id = this.css.id;
      if (this.css.classes) {
        el.classList.add(...this.css.classes);
      }
      if (this.css.style) {
        for (const [key, value] of Object.entries(this.css.style)) {
          (el.style as any)[key] = value;
        }
      }
    }

    if (this.content) {
      if (typeof this.content === "string") {
        el.textContent = this.content;
      }
    }

    const activeChildElements = new Set<HTMLElement>();
    for (const child of this.children) {
      child.render();
      if (child.element) {
        activeChildElements.add(child.element);
        if (child.element.parentNode !== el) {
          el.appendChild(child.element);
        }
      }
    }

    const domChildren = Array.from(el.children);
    for (const domChild of domChildren) {
      if (!activeChildElements.has(domChild as HTMLElement)) {
        domChild.remove();
      }
    }

    if (oldElement && oldElement !== el) {
      if (oldElement.parentNode) {
        oldElement.replaceWith(el);
      } else {
        oldElement.remove();
      }
    }

    this.hasChangedSinceRender = false;
    return el;
  }

  public addChild(childDataOrNode: NodeData | Node): Node {
    let childNode: Node;
    if (childDataOrNode instanceof Node) {
      childNode = childDataOrNode;
      childNode.parent = this;
    } else {
      childNode = new Node(childDataOrNode as NodeData, this);
    }

    this.hasChangedSinceRender = true;
    this.children.push(childNode);

    if (this.element) {
      const childEl = childNode.render();
      if (childEl) {
        this.element.appendChild(childEl);
      }
    }

    return childNode;
  }

  public delete(): void {
    if (this.parent) {
      this.parent.hasChangedSinceRender = true;
      const index = this.parent.children.indexOf(this);
      if (index > -1) {
        this.parent.children.splice(index, 1);
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

  public modify(newData: Partial<NodeData>): void {
    // Modify strictly the original untouched node.data for persistence
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
    mergeDeep(this.data, newData);
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
    if (depth === 0) console.log(`[DEBUG] findNode starting query on node type '${this.type}'`);
    if (this.isMatch(query)) {
      console.log(`[DEBUG] findNode MATCH found at node type '${this.type}' (depth ${depth}):`, this);
      return this;
    }

    for (const child of this.children) {
      const found = child.findNode(query, depth + 1);
      if (found) return found;
    }

    if (depth === 0) {
      const queryString = typeof query === 'function' ? query.toString() : JSON.stringify(query);
      console.log(`[DEBUG] findNode MATCH NOT FOUND for query:`, queryString);
    }
    return null;
  }

  public executeHandlers(phase: string, context: any): void {
    if (this.handlers && this.handlers[phase]) {
      try {
        const trimmedValue = String(this.handlers[phase]).trim();
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          const fn = new Function('return ' + trimmedValue)();
          fn({ ...context, node: this, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI });
        } else {
          const fn = new Function('context', trimmedValue);
          fn({ ...context, node: this, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI });
        }
      } catch (err) {
        console.error(`Failed to execute ${phase} handler on node:`, err);
      }
    }

    for (const child of this.children) {
      child.executeHandlers(phase, context);
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
