import type { NodeData } from "../types/NodeSchema";
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
  
  public static placementArray: Node[] = [];
  public static sourcePlacements: Node[] = [];
  public originalParent: Node | null = null;
  public originalIndex: number = -1;

  constructor(data: NodeData, parent: Node | null = null) {
    this.data = data;
    this.parent = parent;

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
    if (this.parent) {
      this.originalParent = this.parent;
      this.originalIndex = this.parent.children.indexOf(this);
      if (this.originalIndex > -1) {
        this.parent.children.splice(this.originalIndex, 1);
      }
    }
    this.parent = target;
    target.children.push(this);
  }

  public restorePlacement(): void {
    if (this.originalParent && this.originalIndex > -1) {
      if (this.parent) {
        const index = this.parent.children.indexOf(this);
        if (index > -1) {
          this.parent.children.splice(index, 1);
        }
      }
      this.parent = this.originalParent;
      this.parent.children.splice(this.originalIndex, 0, this);
      this.originalParent = null;
      this.originalIndex = -1;
    }
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

    const el = document.createElement(this.data.type || "div");
    this.element = el;

    if (this.data.props) {
      for (const [key, value] of Object.entries(this.data.props)) {
        el.setAttribute(key, String(value));
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
      if (!child.element) {
        child.render();
      }
      if (child.element) {
        el.appendChild(child.element);
      }
    }

    if (oldElement) {
      if (oldElement.parentNode) {
        oldElement.replaceWith(el);
      } else {
        oldElement.remove();
      }
    }

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

  public validate(): boolean {
    let valid = true;
    if (!this.data.type) {
      console.error("Node validation failed: missing 'type' property", this.data);
      valid = false;
    } else {
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
      child.validate();
    }
    this.isValid = valid;
    return valid;
  }

  public exportToJson(): NodeData {
    const exported: any = { ...this.data };
    delete exported.parent;
    
    if (this.styleNodes.length > 0) {
      exported.css = { ...exported.css };
      exported.css.cssDef = this.styleNodes.map(sn => sn.exportToJson());
    }

    if (this.children.length > 0) {
      exported.content = this.children.map(child => child.exportToJson());
    }
    return exported as NodeData;
  }
}
