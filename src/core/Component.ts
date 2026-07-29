import type { ComponentBinding, HandlerDef, NodeData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

/**
 * OOP representation of a reusable Component Binding in Preempt.
 *
 * @useCase Handles component reference lookup, sub-tree instantiation, target path injection (`type`, `css.style`, `handlers.*`, `content`), and tree reference tracking.
 * @processFlow Resolved during Phase 2 (`ComponentAssemblyWorker`) for structural components and Phase 3 (`SlotAssemblyWorker`) for non-type target properties.
 */
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

  /** Source component provider found by searching up the virtual DOM tree. */
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

  /**
   * Constructs a new Component instance.
   *
   * @param data ComponentBinding schema payload.
   * @param parent Host Node instance.
   * @param phase Execution phase ID.
   * @param _isInTree Boolean indicating tree membership.
   */
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
        this._instantiatedNodes = [new Node(this.value as NodeData, undefined, 99, false)];
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

  /**
   * Merges incoming component bindings into a target Node.
   *
   * @param targetNode Target Node instance.
   * @param incomingComponents Array of component bindings or Component objects.
   * @returns Next phase ID (2 for structural type components, 3 for slot components) or undefined on lock failure.
   */
  public static mergeComponents(targetNode: Node, incomingComponents: ComponentBinding[] | Component[]): number | undefined {
    if (Supervisor.isPhaseLocked(2) || Supervisor.isPropertyLocked('component')) {
      console.error(`[Component] Lock violation: Phase 2 or property 'component' is currently locked for node ${targetNode.css?.id || 'unknown'}`);
      return undefined;
    }

    const oldComponents = targetNode.component || [];
    const newComponents = incomingComponents || [];

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
      console.error(`[Component] receiveNextState rejected: Cannot modify source components via receiveNextState. Please update node.data state and pass layout change to Supervisor. Node ID: ${targetNode.css?.id || 'unknown'}`);
      return undefined;
    }

    const componentInstances = incomingComponents.map(c => c instanceof Component ? c : new Component(c, targetNode, 0));
    targetNode.setComponents(componentInstances, 0);

    const hasTypeComp = componentInstances.some(c => c.target === "type");
    return hasTypeComp ? 2 : 3;
  }

  /**
   * Clones this Component binding instance.
   *
   * @param ignoreProps Property exclusion list.
   * @param newParent Target parent Node.
   * @param phase Execution phase ID.
   * @returns Cloned Component instance.
   */
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
        n.clone([], ['element', '_referencingNodes'], undefined, targetPhase)
      );
    }
    if (!ignoreProps.includes('_clonedChildren') && this._clonedChildren) {
      cloned._clonedChildren = this._clonedChildren.map((n: Node) =>
        n.clone([], ['element', '_referencingNodes'], undefined, targetPhase)
      );
    }
    if (!ignoreProps.includes('rollback') && this.rollback !== undefined) {
      cloned.rollback = typeof this.rollback?.clone === 'function' ? this.rollback.clone() : this.rollback;
    }

    return cloned;
  }

  /**
   * Resolves component reference payload by searching up the virtual DOM tree.
   *
   * @returns Object containing `resolvedValue` and matching `resolvedBinding` Component instance.
   * @useCase Component resolution during Assembly phases.
   * @processFlow Upward tree search matching reference string.
   */
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

  /**
   * Clones instantiated component nodes for injection into a referencing target node.
   *
   * @param referencingNode Target node receiving cloned sub-tree.
   * @param phase Execution phase ID.
   * @returns Array of cloned Node instances.
   */
  public cloneNode(referencingNode: any, phase: number): any[] {
    this._referencingNodes.add(referencingNode);

    if (!this._clonedChildren) this._clonedChildren = [];

    if (!this._instantiatedNodes || this._instantiatedNodes.length === 0) {
      return [];
    }

    const targetPhase = phase;

    const clones = this._instantiatedNodes.map(node => {
      return node.clone(
        [],
        ['element', '_referencingNodes'],
        referencingNode,
        targetPhase
      );
    });

    this._clonedChildren.push(...clones);
    return clones;
  }

  /**
   * Destroys component binding and releases child node references.
   */
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

