import type { NodeData } from "../types/NodeSchema";
import { StyleNode } from "./StyleNode";

export class Node {
  public data: NodeData;
  public children: Node[] = [];
  public parent: Node | null = null;
  public element: HTMLElement | null = null;
  public styleNodes: StyleNode[] = [];
  public isValid: boolean = true;

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
      this.element.appendChild(childEl);
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
      if (!oldElement && this.element && this.parent && this.parent.element) {
        this.parent.element.appendChild(this.element);
      }
    }
  }

  public validate(): boolean {
    let valid = true;
    if (!this.data.type) {
      console.error("Node validation failed: missing 'type' property", this.data);
      valid = false;
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
