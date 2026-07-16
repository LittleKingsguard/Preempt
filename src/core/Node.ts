import type { NodeData, NodeQuery, HandlerDef, ComponentBinding } from "../types/NodeSchema.js";
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
  public handlers?: Record<string, string | HandlerDef>;
  public compiledHandlers: Record<string, Function> = {};
  public css: { id?: string; classes?: string[]; style?: Record<string, string>; cssDef?: any[] } = {};
  public versions?: any[];

  public static placementArray: Node[] = [];
  public static sourcePlacements: Node[] = [];
  public static typeComponentNodes: Node[] = [];
  public originalParent: Node | null = null;
  public originalIndex: number = -1;
  public wasPlaced: boolean = false;
  private _attachedListeners: { eventName: string, handlerFunc: EventListener }[] = [];

  public static globalMetadata: any = {};

  private static deepClone(val: any) {
    if (val === undefined) return undefined;
    const seen = new WeakSet();
    const replacer = (k: string, v: any) => {
      if (k === 'node' || k === '_instantiatedNodes' || k === '_referencingNodes' || k === 'parent' || k === 'children' || k === 'originalParent') return undefined;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined; // Prevent cycle
        seen.add(v);
      }
      return v;
    };
    try {
      return JSON.parse(JSON.stringify(val, replacer));
    } catch (e) {
      console.warn("Cycle detected during deepClone, falling back", e);
      return val;
    }
  }

  public static idCollisions = new Map<string, number>();

  public static generateObjectHash(obj: any): string {
    const replacer = (k: string, v: any) => {
      if (k === 'node' || k === 'css' || k === '_instantiatedNodes' || k === '_referencingNodes' || k === 'parent' || k === 'children' || k === 'originalParent') return undefined;
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
      const seenUntargetedRefs = new Set<string>();
      filtered = filtered.reverse().filter(c => {
        if (!c.target) {
          if (seenUntargetedRefs.has(c.reference)) return false;
          seenUntargetedRefs.add(c.reference);
          return true;
        }
        return true;
      }).reverse();

      if (filtered.length > 0) {
        this.component = filtered;
      } else {
        delete this.component;
      }
    }
  }

  constructor(data: NodeData, parent: Node | null = null, isComponentInjected: boolean = false) {
    this.data = data;
    this.parent = parent;
    this.isComponentInjected = isComponentInjected;
    this.resolveVersion();

    this.props = Node.deepClone(this.data.props) || {};
    this.css = Node.deepClone(this.data.css) || {};
    if (!this.css.id) {
      this.css.id = this.props.id || Node.generateObjectHash(this.data);
    }

    if (typeof window !== 'undefined' && this.css.id) {
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

    if (data.content) {
      if (Array.isArray(data.content)) {
        data.content.forEach(childData => {
          this.children.push(new Node(childData, this, isComponentInjected));
        });
      } else if (typeof data.content === "object" && data.content !== null) {
        this.children.push(new Node(data.content, this, isComponentInjected));
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
      for (const [key, value] of Object.entries(this.handlers)) {
        const handlerBody = typeof value === 'object' && value !== null && 'body' in value ? value.body : String(value);
        const compiled = clientAPI.compileHandler(key, handlerBody);
        if (compiled) this.compiledHandlers[key] = compiled;
      }
    }

    this.setComponents(Node.deepClone(this.data.component));
    if (this.component) {
      this.component.forEach((binding: any) => {
        const isHandler = typeof binding.value === 'object' && binding.value !== null && 'body' in binding.value;
        if (isHandler) {
          const handlerName = binding.value.name || binding.reference;
          const compiled = clientAPI.compileHandler(handlerName, binding.value.body);
          if (compiled) this.compiledHandlers[handlerName] = compiled;
        }
      });
    }

    this.placement = Node.deepClone(this.data.placement);
    if (this.placement === undefined) delete this.placement;

    this.versions = Node.deepClone(this.data.versions);
    if (this.versions === undefined) delete this.versions;

    this.resolveVersion();

    if (this.component) {
      for (const binding of this.component) {
        if (binding === null) continue;
        if (typeof binding.value === "object" && binding.value !== null) {
          const dataArray = Array.isArray(binding.value) ? binding.value : [binding.value];
          binding._instantiatedNodes = [];
          for (const d of dataArray) {
            if (typeof d !== "string" && !('body' in d)) {
              const newNode = new Node(d, this, true);
              binding._instantiatedNodes!.push(newNode);
              Node.typeComponentNodes.push(newNode);
            }
          }
        }
      }
    }
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



  public applyComponentsTree(): void {
    if (this.hasChangedSinceRender) {
      this.applyComponents();
    }

    for (const child of this.children) {
      child.applyComponentsTree();
    }
  }

  private applyComponents(processedComponents: Set<any> = new Set()): void {
    if (!this.component) return;

    const deepCloneInstantiated = (node: Node, newParent: Node): Node => {
      const cloned = new Node(node.data, newParent, true);
      cloned.type = node.type;
      cloned.content = node.content;
      cloned.css = Node.deepClone(node.css) || {};
      cloned.props = Node.deepClone(node.props) || {};
      cloned.handlers = Node.deepClone(node.handlers);
      cloned.compiledHandlers = { ...node.compiledHandlers };
      cloned.setComponents(Node.deepClone(node.component));
      cloned.children = [];
      for (const child of node.children) {
        cloned.children.push(deepCloneInstantiated(child, cloned));
      }
      return cloned;
    };

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
      let resolvedBinding: ComponentBinding | null = binding.value !== undefined ? binding : null;

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
            resolvedBinding = parentBinding;
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
        let root = this as any;
        let chain = [];
        while (root.parent) {
          chain.push(root.type + (root.css?.id ? '#' + root.css.id : ''));
          root = root.parent;
        }
        chain.push(root.type);
        console.error(`[DEBUG] Root node components:`, root.component?.map((c: any) => c.reference));
        console.error(`[DEBUG] Current node chain:`, chain.reverse().join(' -> '));
        console.error(`Component binding failed: Could not resolve value for reference '${binding.reference}' targeting '${binding.target}'`);
        continue;
      }

      this.hasChangedSinceRender = true;

      if (binding.target === "type") {
        const dataArray = Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];

        if (binding._clonedChildren) {
          this.children = this.children.filter(c => !binding._clonedChildren!.includes(c));
        }
        binding._clonedChildren = [];
        if (binding._appendedContent && this.content !== undefined && typeof this.content === 'string') {
          this.content = this.content.replace(binding._appendedContent, "");
        }
        binding._appendedContent = "";

        for (const d of dataArray) {
          if (typeof d === "string") {
            this.type = d;
            continue;
          }

          const instantiatedNode = resolvedBinding?._instantiatedNodes?.[dataArray.indexOf(d)];
          if (instantiatedNode) {
            if (instantiatedNode.type) this.type = instantiatedNode.type;

            for (const child of instantiatedNode.children) {
              const clonedChild = deepCloneInstantiated(child, this);
              this.children.push(clonedChild);
              binding._clonedChildren!.push(clonedChild);
            }

            if (instantiatedNode.content !== undefined) {
              if (this.content !== undefined) {
                this.content += instantiatedNode.content as string;
              } else {
                this.content = instantiatedNode.content as string;
              }
              binding._appendedContent += instantiatedNode.content as string;
            }

            if (instantiatedNode.css) {
              if (!this.css) this.css = {};
              if (instantiatedNode.css.style) this.css.style = { ...this.css.style, ...instantiatedNode.css.style };
              if (instantiatedNode.css.classes) this.css.classes = [...new Set([...(this.css.classes || []), ...instantiatedNode.css.classes])];
              if (instantiatedNode.css.cssDef) {
                this.css.cssDef = [...(this.css.cssDef || []), ...instantiatedNode.css.cssDef];
                for (const def of instantiatedNode.css.cssDef) {
                  this.styleNodes.push(new StyleNode(def, this, true));
                }
              }
            }

            if (instantiatedNode.props) this.props = { ...this.props, ...instantiatedNode.props };
            if (instantiatedNode.handlers) {
              if (!this.handlers) this.handlers = {};
              this.handlers = { ...this.handlers, ...instantiatedNode.handlers };
            }
            if (instantiatedNode.compiledHandlers) {
              this.compiledHandlers = { ...instantiatedNode.compiledHandlers };
            }
            if (instantiatedNode.component) {
              this.setComponents([...(this.component || []), ...instantiatedNode.component]);
              addedNew = true;
            }
          }
        }
        continue;
      }

      if (typeof resolvedValue === "string") {
        this.applyProperty(binding.target, resolvedValue);
      } else if (typeof resolvedValue === "object" && resolvedValue !== null && binding.target.startsWith("handlers.")) {
        this.applyProperty(binding.target, resolvedValue as unknown as string | HandlerDef);
      } else if (binding.target === "content") {
        if (Array.isArray(resolvedValue)) {
          this.content = undefined;
          this.children = [];
          for (let i = 0; i < resolvedValue.length; i++) {
            const instantiatedNode = resolvedBinding?._instantiatedNodes?.[i];
            if (instantiatedNode) {
              this.children.push(deepCloneInstantiated(instantiatedNode, this));
            } else if (typeof resolvedValue[i] === "object" && resolvedValue[i] !== null) {
              this.children.push(new Node(resolvedValue[i] as NodeData, this, true));
            }
          }
        } else if (typeof resolvedValue === "object" && resolvedValue !== null) {
          this.content = undefined;
          let instantiatedNode = resolvedBinding?._instantiatedNodes?.[0];
          if (instantiatedNode) {
            this.children = [deepCloneInstantiated(instantiatedNode, this)];
          } else {
            this.children = [new Node(resolvedValue as NodeData, this, true)];
          }
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


  private applyProperty(path: string, value: string | HandlerDef): void {
    let changed = false;
    if (path === "content") {
      if (this.content !== (value as string)) changed = true;
      this.content = value as string;
    } else if (path.startsWith("props.")) {
      const propName = path.substring(6);
      if (!this.props) this.props = {};
      if (this.props[propName] !== (value as string)) changed = true;
      this.props[propName] = value as string;
    } else if (path.startsWith("handlers.")) {
      const handlerName = path.substring(9);
      if (!this.handlers) this.handlers = {};
      if (this.handlers[handlerName] !== value) changed = true;
      this.handlers[handlerName] = value as string | HandlerDef;
    } else if (path.startsWith("css.style.")) {
      const styleName = path.substring(10);
      if (!this.css) this.css = {};
      if (!this.css.style) this.css.style = {};
      if (this.css.style[styleName] !== (value as string)) changed = true;
      this.css.style[styleName] = value as string;
    }
    if (changed) {
      this.hasChangedSinceRender = true;
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
    Node.typeComponentNodes = [];
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
    this.wasPlaced = true;
    target.hasChangedSinceRender = true;
    target.children.push(this);

    if (target.placement) {
      if (!target.placement._referencingNodes) target.placement._referencingNodes = [];
      if (!target.placement._referencingNodes.includes(this)) {
        target.placement._referencingNodes.push(this);
      }
    }

    console.log("This node was placed", this, target);
  }

  public restorePlacement(): void {
    if (!this.wasPlaced) return;

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

    if (this.originalParent && this.originalIndex > -1) {
      this.parent = this.originalParent;
      this.parent.hasChangedSinceRender = true;
      this.parent.children.splice(this.originalIndex, 0, this);
    } else {
      this.parent = null;
    }

    this.originalParent = null;
    this.originalIndex = -1;
    this.wasPlaced = false;
  }

  public static restoreAllPlacements(): void {
    for (const node of Node.sourcePlacements) {
      node.restorePlacement();
    }
    Node.clearPlacements();
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
        const handlerBody = typeof value === 'object' && value !== null && 'body' in value ? (value as any).body : String(value);
        const trimmedValue = String(handlerBody).trim();
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

    if (shouldReuse && el) {
      for (const listener of this._attachedListeners) {
        el.removeEventListener(listener.eventName, listener.handlerFunc);
      }
    }
    this._attachedListeners = [];

    if (this.handlers) {
      for (const [key, value] of Object.entries(this.handlers)) {
        try {
          let handlerFunc: EventListener;
          const handlerObj = value as any;
          const context = { node: this, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI };

          let fn: Function | undefined;
          if (typeof handlerObj === 'object' && handlerObj !== null && 'name' in handlerObj) {
            fn = clientAPI.getHandler(handlerObj.name, this);
          } else {
            fn = clientAPI.getHandler(key, this);
          }

          if (fn) {
            handlerFunc = ((event: Event) => fn!(event, context)) as EventListener;
          } else {
            const handlerBody = typeof handlerObj === 'object' && handlerObj !== null && 'body' in handlerObj ? handlerObj.body : String(handlerObj);
            const trimmedValue = handlerBody.trim();
            if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
              fn = new Function('return ' + trimmedValue)();
              handlerFunc = ((event: Event) => fn!(event, context)) as EventListener;
            } else {
              fn = new Function('event', 'context', trimmedValue);
              handlerFunc = ((event: Event) => fn!(event, context)) as EventListener;
            }
          }
          const eventName = key.startsWith('on') ? key.substring(2).toLowerCase() : key.toLowerCase();
          el.addEventListener(eventName, handlerFunc);
          this._attachedListeners.push({ eventName, handlerFunc });
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

    if (["input", "textarea", "select"].includes(targetTag)) {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const inputKey = this.props?.inputKey || this.css?.id || this.data.css?.id;
      if (inputKey) {
        if (Node.globalMetadata[inputKey] !== undefined) {
          inputEl.value = Node.globalMetadata[inputKey];
        } else if (this.content !== undefined && typeof this.content === "string") {
          inputEl.value = this.content;
          Node.globalMetadata[inputKey] = this.content;
        }

        if (!oldElement || !shouldReuse) {
          el.addEventListener('input', (event: Event) => {
            const target = event.target as HTMLInputElement;
            Node.globalMetadata[inputKey] = target.value;
          });
        }
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
    if (this.isMatch(query)) {
      return this;
    }

    for (const child of this.children) {
      const found = child.findNode(query, depth + 1);
      if (found) return found;
    }

    return null;
  }

  public executeHandlers(phase: string, context: any): void {
    if (this.handlers && this.handlers[phase]) {
      try {
        const handlerObj = this.handlers[phase] as any;
        const fullContext = { ...context, node: this, metadata: Node.globalMetadata, rootNode: Supervisor.getRootNode(), contentPayload: Supervisor.instance?.contentData || [], clientAPI };

        let fn: Function | undefined;
        if (typeof handlerObj === 'object' && handlerObj !== null && 'name' in handlerObj) {
          fn = clientAPI.getHandler(handlerObj.name, this);
        } else {
          fn = clientAPI.getHandler(phase, this);
        }

        if (fn) {
          if (fn.length === 1) {
            fn(fullContext);
          } else {
            fn(null, fullContext);
          }
        } else {
          const handlerBody = typeof handlerObj === 'object' && handlerObj !== null && 'body' in handlerObj ? handlerObj.body : String(handlerObj);
          const trimmedValue = handlerBody.trim();
          if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
            fn = new Function('return ' + trimmedValue)();
            if (fn!.length === 1) {
              console.log(`[DEBUG] Executing phase handler ${phase} on node ${this.css?.id} (args=1). Body: ${trimmedValue.substring(0, 50)}`);
              fn!(fullContext);
            } else {
              console.log(`[DEBUG] Executing phase handler ${phase} on node ${this.css?.id} (args=2). Body: ${trimmedValue.substring(0, 50)}`);
              fn!(null, fullContext);
            }
          } else {
            console.log(`[DEBUG] Executing phase handler ${phase} on node ${this.css?.id} (raw string). Body: ${trimmedValue.substring(0, 50)}`);
            fn = new Function('event', 'context', trimmedValue);
            fn!(null, fullContext);
          }
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
