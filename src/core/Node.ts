import type { NodeData, NodeQuery } from "../types/NodeSchema";
import { StyleNode } from "./StyleNode";

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
  public hasChangedSinceRender: boolean = true;

  public static placementArray: Node[] = [];
  public static sourcePlacements: Node[] = [];
  public originalParent: Node | null = null;
  public originalIndex: number = -1;
  public static nodeCounter: number = 0;
  public static globalMetadata: any = {};

  constructor(data: NodeData, parent: Node | null = null, isComponentInjected: boolean = false) {
    this.data = data;
    this.parent = parent;
    this.isComponentInjected = isComponentInjected;

    this.resolveVersion();

    if (!this.data.css) this.data.css = {};
    if (!this.data.css.id) this.data.css.id = `preempt-node-${Node.nodeCounter++}`;
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

    Node.appendPlacement(this);
  }

  private resolveVersion(): void {
    const targetVersion = this.data.props?.version || Node.globalMetadata?.version;
    if (!targetVersion || typeof targetVersion.timestamp !== 'number' || !this.data.versions || this.data.versions.length === 0) {
      return;
    }

    const targetTimestamp = targetVersion.timestamp;
    
    const sortedVersions = [...this.data.versions].sort((a, b) => b.timestamp - a.timestamp);
    const matchedVersion = sortedVersions.find(v => v.timestamp <= targetTimestamp);

    if (matchedVersion) {
      if (matchedVersion.content !== undefined) {
        this.data.content = matchedVersion.content;
      }
      if (matchedVersion.props !== undefined) {
        this.data.props = matchedVersion.props;
      }
      if (matchedVersion.component !== undefined) {
        this.data.component = matchedVersion.component;
      }
      if (matchedVersion.css !== undefined) {
        this.data.css = matchedVersion.css;
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
    if (!this.data.component) return;

    const componentsToProcess = this.data.component.filter(c => !processedComponents.has(c));
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

      if (resolvedValue === null) {
        let currentParent = this.parent;
        while (currentParent) {
          const parentBinding = currentParent.data.component?.find(b => b.reference === binding.reference);
          if (parentBinding && parentBinding.value !== null && parentBinding.value !== undefined) {
            resolvedValue = parentBinding.value;
            break;
          }
          currentParent = currentParent.parent;
        }
      }

      if (resolvedValue === null) {
        console.error(`Component binding failed: Could not resolve value for reference '${binding.reference}' targeting '${binding.target}'`);
        continue;
      }

      if (binding.target === "type") {
        const dataArray = Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];
        for (const d of dataArray) {
          if (typeof d === "string") {
            this.data.type = d;
            continue;
          }

          if (d.type) this.data.type = d.type;

          if (d.content) {
            if (Array.isArray(d.content)) {
              if (!this.data.content) this.data.content = [];
              if (!Array.isArray(this.data.content)) this.data.content = [this.data.content as any];
              d.content.forEach(childData => {
                (this.data.content as NodeData[]).push(childData);
                this.children.push(new Node(childData, this, true));
              });
            } else if (typeof d.content === "object" && d.content !== null) {
              if (!this.data.content) this.data.content = [];
              if (!Array.isArray(this.data.content)) this.data.content = [this.data.content as any];
              (this.data.content as NodeData[]).push(d.content);
              this.children.push(new Node(d.content, this, true));
            } else if (typeof d.content === "string") {
              if (typeof this.data.content === "string") {
                this.data.content += d.content;
              } else {
                this.data.content = d.content;
              }
            }
          }

          if (d.css) {
            if (!this.data.css) this.data.css = {};
            if (d.css.style) this.data.css.style = { ...this.data.css.style, ...d.css.style };
            if (d.css.classes) this.data.css.classes = [...new Set([...(this.data.css.classes || []), ...d.css.classes])];
            if (d.css.cssDef) {
              this.data.css.cssDef = [...(this.data.css.cssDef || []), ...d.css.cssDef];
              for (const def of d.css.cssDef) {
                this.styleNodes.push(new StyleNode(def, this));
              }
            }
          }

          if (d.props) this.data.props = { ...this.data.props, ...d.props };
          if (d.handlers) this.data.handlers = { ...this.data.handlers, ...d.handlers };
          if (d.component) {
            this.data.component = [...(this.data.component || []), ...d.component];
            addedNew = true;
          }
        }
        continue;
      }

      if (typeof resolvedValue === "string") {
        this.applyProperty(binding.target, resolvedValue);
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
      this.data.content = value;
    } else if (path.startsWith("props.")) {
      const propName = path.substring(6);
      if (!this.data.props) this.data.props = {};
      this.data.props[propName] = value;
    } else if (path.startsWith("handlers.")) {
      const handlerName = path.substring(9);
      if (!this.data.handlers) this.data.handlers = {};
      this.data.handlers[handlerName] = value;
    } else if (path.startsWith("css.style.")) {
      const styleName = path.substring(10);
      if (!this.data.css) this.data.css = {};
      if (!this.data.css.style) this.data.css.style = {};
      this.data.css.style[styleName] = value;
    }
  }

  public static appendPlacement(node: Node): void {
    if (node.data.placement?.placementName) {
      Node.placementArray.push(node);
    }
    if (node.data.placement?.targetPlacement) {
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
  }

  public restorePlacement(): void {
    if (this.originalParent && this.originalIndex > -1) {
      if (this.parent) {
        this.parent.hasChangedSinceRender = true;
        const index = this.parent.children.indexOf(this);
        if (index > -1) {
          this.parent.children.splice(index, 1);
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

    const tag = this.data.type || "div";
    let attributes = "";

    if (this.data.props) {
      for (const [key, value] of Object.entries(this.data.props)) {
        const escapedValue = String(value).replace(/"/g, '&quot;');
        attributes += ` ${key}="${escapedValue}"`;
      }
    }

    if (this.data.handlers) {
      for (const [key, value] of Object.entries(this.data.handlers)) {
        const eventName = key.startsWith('on') ? key.toLowerCase() : `on${key.toLowerCase()}`;
        const trimmedValue = String(value).trim();
        let jsCode = trimmedValue;
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          jsCode = `(${trimmedValue})(event, { node: null })`;
        }
        const escapedValue = jsCode.replace(/"/g, '&quot;');
        attributes += ` ${eventName}="${escapedValue}"`;
      }
    }

    if (this.data.css) {
      if (this.data.css.id) attributes += ` id="${this.data.css.id}"`;
      if (this.data.css.classes && this.data.css.classes.length > 0) {
        attributes += ` class="${this.data.css.classes.join(" ")}"`;
      }
      if (this.data.css.style) {
        const styleStr = Object.entries(this.data.css.style)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}: ${v}`)
          .join("; ");
        if (styleStr) attributes += ` style="${styleStr}"`;
      }
    }

    let innerHTML = "";
    if (this.data.content) {
      if (typeof this.data.content === "string") {
        innerHTML += this.data.content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }
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

    const targetTag = (this.data.type || "div").toLowerCase();
    const shouldReuse = oldElement && oldElement.tagName.toLowerCase() === targetTag;
    const el = shouldReuse ? oldElement! : document.createElement(targetTag);
    this.element = el;

    if (this.data.props) {
      for (const [key, value] of Object.entries(this.data.props)) {
        el.setAttribute(key, String(value));
      }
    }

    if (this.data.handlers) {
      for (const [key, value] of Object.entries(this.data.handlers)) {
        try {
          let handlerFunc: EventListener;
          const trimmedValue = String(value).trim();
          if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
            const fn = new Function('return ' + trimmedValue)();
            handlerFunc = ((event: Event) => fn(event, { node: this })) as EventListener;
          } else {
            const fn = new Function('event', 'context', trimmedValue);
            handlerFunc = ((event: Event) => fn(event, { node: this })) as EventListener;
          }
          const eventName = key.startsWith('on') ? key.substring(2).toLowerCase() : key.toLowerCase();
          el.addEventListener(eventName, handlerFunc);
        } catch (err) {
          console.error(`Failed to parse handler for event ${key}:`, err);
        }
      }
    }

    if (this.data.css) {
      if (this.data.css.id) el.id = this.data.css.id;
      if (this.data.css.classes) {
        el.classList.add(...this.data.css.classes);
      }
      if (this.data.css.style) {
        for (const [key, value] of Object.entries(this.data.css.style)) {
          (el.style as any)[key] = value;
        }
      }
    }

    if (this.data.content) {
      if (typeof this.data.content === "string") {
        el.textContent = this.data.content;
      }
    }

    for (const child of this.children) {
      child.render();
      if (child.element && child.element.parentNode !== el) {
        el.appendChild(child.element);
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
    this.hasChangedSinceRender = true;
    this.data = { ...this.data, ...newData };
    this.validate();
    if (this.element || this.isValid) {
      const oldElement = this.element;
      this.render();
      const newElement = this.element;
      if (!oldElement && newElement && this.parent && this.parent.element) {
        this.parent.element.appendChild(newElement);
      }
    }
  }

  public validate(bubbleErrors: boolean = false): boolean {
    let valid = true;
    if (!this.data.type) {
      console.error("Node validation failed: missing 'type' property", this.data);
      valid = false;
    } else {
      if (this.data.component) {
        const typeTargets = this.data.component.filter(c => c.target === "type");
        if (typeTargets.length > 1) {
          console.error("Node validation failed: node cannot have more than one 'type' target in components", this.data);
          valid = false;
        }
      }
      const requiredProps = Node.REQUIRED_PROPS_MAP[this.data.type.toLowerCase()];
      if (requiredProps) {
        for (const prop of requiredProps) {
          if (!this.data.props || !this.data.props[prop]) {
            console.error(`Node validation failed: '${this.data.type}' missing required property: '${prop}'`, this.data);
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
    
    if (query.id && this.data.css?.id !== query.id) return false;
    if (query.type && this.data.type !== query.type) return false;
    
    if (query.classes && query.classes.length > 0) {
      if (!this.data.css?.classes) return false;
      const hasAllClasses = query.classes.every(c => this.data.css!.classes!.includes(c));
      if (!hasAllClasses) return false;
    }
    
    if (query.props) {
      if (!this.data.props) return false;
      for (const [k, v] of Object.entries(query.props)) {
        if (this.data.props[k] !== v) return false;
      }
    }
    
    if (query.style) {
      if (!this.data.css?.style) return false;
      for (const [k, v] of Object.entries(query.style)) {
        if (this.data.css.style[k] !== v) return false;
      }
    }
    
    if (query.handlers) {
      if (!this.data.handlers) return false;
      for (const [k, v] of Object.entries(query.handlers)) {
        if (this.data.handlers[k] !== v) return false;
      }
    }
    
    if (query.components && query.components.length > 0) {
      if (!this.data.component) return false;
      for (const compQuery of query.components) {
        const match = this.data.component.some(c => {
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

  public findNode(query: NodeQuery | ((node: Node) => boolean)): Node | null {
    if (this.isMatch(query)) {
      return this;
    }

    for (const child of this.children) {
      const found = child.findNode(query);
      if (found) return found;
    }

    return null;
  }

  public executeHandlers(phase: string, context: any): void {
    if (this.data.handlers && this.data.handlers[phase]) {
      try {
        const trimmedValue = String(this.data.handlers[phase]).trim();
        if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
          const fn = new Function('return ' + trimmedValue)();
          fn({ ...context, node: this });
        } else {
          const fn = new Function('context', trimmedValue);
          fn({ ...context, node: this });
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
    const exported: any = { ...this.data };
    delete exported.parent;

    if (exported.css) {
      exported.css = { ...exported.css };
      if (exported.css.id && exported.css.id.startsWith("preempt-node-")) {
        delete exported.css.id;
      }
    }

    if (this.styleNodes.length > 0 && exported.css) {
      exported.css.cssDef = this.styleNodes.map(sn => sn.exportToJson());
    }

    const nativeChildren = this.children.filter(child => !child.isComponentInjected);
    if (nativeChildren.length > 0) {
      exported.content = nativeChildren.map(child => child.exportToJson());
    } else {
      delete exported.content;
    }
    return exported as NodeData;
  }
}
