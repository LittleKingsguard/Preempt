import type { ComponentBinding, HandlerDef, NodeData } from "../types/NodeSchema.js";
import { CloneUtils } from "./utils/CloneUtils.js";
import type { Node } from "./Node.js";

export class Component implements ComponentBinding {
  public reference: string;
  public target?: string | undefined;
  public value?: string | HandlerDef | NodeData | NodeData[] | null | undefined;
  public _referencingNodes?: Set<any> | undefined;
  public _instantiatedNodes?: any[] | undefined;
  public _clonedChildren?: any[] | undefined;
  public _appendedContent?: string | undefined;
  public parent: Node;

  private _sourceComponent?: Component | undefined;

  public get sourceComponent(): Component | undefined {
    return this._sourceComponent;
  }

  public set sourceComponent(newSource: Component | undefined) {
    if (this._sourceComponent === newSource) return;

    if (this._sourceComponent && this._sourceComponent._referencingNodes) {
      this._sourceComponent._referencingNodes.delete(this.parent);
    }

    this._sourceComponent = newSource;

    if (this._sourceComponent) {
      if (!this._sourceComponent._referencingNodes) this._sourceComponent._referencingNodes = new Set();
      this._sourceComponent._referencingNodes.add(this.parent);
    }
  }

  constructor(data: ComponentBinding, parent: Node) {
    this.parent = parent;
    this.reference = data.reference;
    this.target = data.target;
    this.value = data.value !== undefined ? CloneUtils.deepClone(data.value) : undefined;
    if (data._referencingNodes) this._referencingNodes = new Set(data._referencingNodes);
    if (data._instantiatedNodes) this._instantiatedNodes = [...data._instantiatedNodes];
    if (data._clonedChildren) this._clonedChildren = [...data._clonedChildren];
    this._appendedContent = data._appendedContent;
  }

  public clone(ignoreProps: string[] = [], newParent: Node): Component {
    const cloned = new Component({
      reference: this.reference,
      target: this.target,
      value: this.value, // It gets deepCloned in constructor
      _referencingNodes: ignoreProps.includes('_referencingNodes') ? undefined : (this._referencingNodes ? new Set(this._referencingNodes) : undefined),
      _instantiatedNodes: ignoreProps.includes('_instantiatedNodes') ? undefined : this._instantiatedNodes,
      _clonedChildren: ignoreProps.includes('_clonedChildren') ? undefined : this._clonedChildren,
      _appendedContent: this._appendedContent
    }, newParent);

    if (!ignoreProps.includes('_sourceComponent') && this.sourceComponent) {
      cloned.sourceComponent = this.sourceComponent;
    }

    return cloned;
  }

  public resolveBinding(): { resolvedValue: any, resolvedBinding: Component | null } {
    let resolvedValue: any = this.value !== undefined ? this.value : null;
    let resolvedBinding: Component | null = this.value !== undefined ? this : null;

    if (resolvedValue !== null) {
      this.sourceComponent = undefined; // It is its own source
      if (!this._referencingNodes) this._referencingNodes = new Set();
      this._referencingNodes.add(this.parent);
    } else {
      let currentNode: Node | null | undefined = this.parent;
      let foundSource = false;
      while (currentNode) {
        const parentBinding = currentNode.sourceComponents?.get(this.reference);
        if (parentBinding) {
          resolvedValue = parentBinding.value !== undefined ? parentBinding.value : null;
          resolvedBinding = parentBinding as Component;
          this.sourceComponent = resolvedBinding;
          foundSource = true;
          break;
        }
        currentNode = currentNode.parent;
      }
      if (!foundSource) {
        this.sourceComponent = undefined;
      }
    }
    return { resolvedValue, resolvedBinding };
  }

  public cloneNode(referencingNode: any): any[] {
    if (!this._referencingNodes) this._referencingNodes = new Set();
    this._referencingNodes.add(referencingNode);

    if (!this._clonedChildren) this._clonedChildren = [];

    if (!this._instantiatedNodes || this._instantiatedNodes.length === 0) {
      return [];
    }

    const clones = this._instantiatedNodes.map(node => node.clone());
    this._clonedChildren.push(...clones);
    return clones;
  }

  public delete(): void {
    if (this._sourceComponent && this._sourceComponent._referencingNodes) {
      this._sourceComponent._referencingNodes.delete(this.parent);
    }
    this._sourceComponent = undefined;

    if (this._referencingNodes) {
      for (const node of this._referencingNodes) {
        node.receiveNextState({}, 0);
      }
      this._referencingNodes.clear();
    }

    if (this._instantiatedNodes) {
      for (const node of this._instantiatedNodes) {
        node.delete();
      }
      this._instantiatedNodes = [];
    }

    if (this._clonedChildren) {
      for (const node of this._clonedChildren) {
        node.delete();
      }
      this._clonedChildren = [];
    }
  }
}
