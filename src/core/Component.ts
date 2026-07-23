import type { ComponentBinding, HandlerDef, NodeData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

export class Component implements ComponentBinding {
  public reference: string;
  public target?: string | undefined;
  public value?: string | HandlerDef | NodeData | NodeData[] | null | undefined;
  public _referencingNodes: Set<Node> = new Set<Node>();
  public _instantiatedNodes?: Node[] | undefined;
  public _clonedChildren?: any[] | undefined;
  public rollback?: any | undefined;
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

  constructor(data: ComponentBinding, parent: Node, phase: number, _isInTree: boolean = false) {
    this.parent = parent;
    this.reference = data.reference;
    this.target = data.target;
    this.value = data.value;

    if (this.value) {
      if (Array.isArray(this.value)) {
        const nodes: Node[] = [];
        for (const item of this.value) {
          if (item && typeof item === 'object' && 'type' in item) {
            nodes.push(new Node(item as NodeData, null, 99, false));
          }
        }
        if (nodes.length > 0) this._instantiatedNodes = nodes;
      } else if (typeof this.value === 'object' && 'type' in this.value) {
        this._instantiatedNodes = [new Node(this.value as NodeData, null, 99, false)];
      }
    }

    if (this.parent && this.parent.isInTree && this.target && phase !== 99) {
      if (phase < 3 && this.target === "type") {
        Supervisor.emitToPhase(this, this.parent, {}, 2); // Phase 2: ComponentAssemblyWorker
      } else if (phase < 4 && this.target !== "type") {
        Supervisor.emitToPhase(this, this.parent, {}, 3); // Phase 3: SlotAssemblyWorker
      }
    }
  }

  public clone(ignoreProps: string[] = [], newParent: Node, phase: number): Component {
    const targetPhase = phase;
    const cloned = new Component({
      reference: this.reference,
      target: this.target,
      value: this.value,
    }, newParent, targetPhase, false);

    // Copy source component if present and not ignored
    if (!ignoreProps.includes('_sourceComponent') && this.sourceComponent) {
      cloned.sourceComponent = this.sourceComponent;
    }

    // Copy runtime properties using clone functions/utilities rather than direct reference
    if (!ignoreProps.includes('_referencingNodes') && this._referencingNodes) {
      cloned._referencingNodes = new Set(this._referencingNodes);
    }
    if (!ignoreProps.includes('_instantiatedNodes') && this._instantiatedNodes) {
      cloned._instantiatedNodes = this._instantiatedNodes.map((n: Node) =>
        n.clone([], ['element', '_referencingNodes'], cloned.parent, targetPhase)
      );
    }
    if (!ignoreProps.includes('_clonedChildren') && this._clonedChildren) {
      cloned._clonedChildren = this._clonedChildren.map((n: Node) =>
        n.clone([], ['element', '_referencingNodes'], cloned.parent, targetPhase)
      );
    }
    if (!ignoreProps.includes('rollback') && this.rollback !== undefined) {
      cloned.rollback = typeof this.rollback?.clone === 'function' ? this.rollback.clone() : this.rollback;
    }

    return cloned;
  }

  public resolveBinding(): { resolvedValue: any, resolvedBinding: Component | null } {
    let resolvedValue: any = this.value !== undefined ? this.value : null;
    let resolvedBinding: Component | null = this.value !== undefined ? this : null;

    if (resolvedValue !== null) {
      this.sourceComponent = undefined; // It is its own source
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
          resolvedBinding._referencingNodes.add(this.parent);
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

  public cloneNode(referencingNode: any, phase: number): any[] {
    this._referencingNodes.add(referencingNode);

    if (!this._clonedChildren) this._clonedChildren = [];

    if (!this._instantiatedNodes || this._instantiatedNodes.length === 0) {
      return [];
    }

    const targetPhase = phase;
    const pass2Phase = targetPhase > 0 ? targetPhase : 99;

    const clones = this._instantiatedNodes.map(node => {
      // Pass 1: Clone node ignoring children, nativeChildren, and placement
      const clonedNode = node.clone(
        ['children', 'nativeChildren', 'placement'],
        ['element', '_referencingNodes'],
        referencingNode,
        targetPhase
      );

      // Pass 2: Manually clone children and placements in a separate pass with placement-blocking phase
      if (node.nativeChildren && node.nativeChildren.length > 0) {
        clonedNode.nativeChildren = node.nativeChildren.map((child: Node) =>
          child.clone([], ['element', '_referencingNodes'], clonedNode, pass2Phase)
        );
        clonedNode.invalidateChildrenCache();
      }

      if (node.placement && node.placement.length > 0) {
        clonedNode.placement = node.placement.map((p: any) =>
          p.clone([], clonedNode, pass2Phase)
        );
      }

      return clonedNode;
    });

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
