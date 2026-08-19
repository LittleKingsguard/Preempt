import type { ComponentBinding, HandlerDef, NodeData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { Handler } from "./Handler.js";
import { Supervisor } from "./Supervisor.js";
import { WorkerMessage } from "./WorkerMessage.js";
import { PhaseRegistry } from "./PhaseRegistry.js";
import { NodeLayer } from "./NodeLayer.js";

/**
 * OOP representation of a reusable Component Binding in Preempt.
 *
 * @useCase Handles component reference lookup, sub-tree instantiation, target path injection, layer building, and tree reference tracking.
 * @processFlow Resolved during ComponentAssemblyWorker (type components) and SlotAssemblyWorker (slot components).
 */
export class Component implements ComponentBinding {
  /** Static cache storing prototype structural nodes, keyed by singular hostNode instance -> component reference. */
  public static nodeCache: Map<Node, Map<string, Node[]>> = new Map<Node, Map<string, Node[]>>();

  public reference: string;
  public target?: string | undefined;
  public value?: string | HandlerDef | NodeData | NodeData[] | null | undefined;
  public _referencingNodes: Set<Node> = new Set<Node>();
  public _instantiatedNodes?: Node[] | undefined;
  public _clonedChildren?: any[] | undefined;
  public parent: Node;

  /** Single-property layer map created by this component. */
  public layerMap: Map<string, NodeLayer> = new Map<string, NodeLayer>();

  private _sourceComponent?: Component | undefined;

  /** Primary instantiated Node definition if this component represents a structural component. */
  public get instantiatedNode(): Node | undefined {
    return this._instantiatedNodes && this._instantiatedNodes.length > 0 ? this._instantiatedNodes[0] : undefined;
  }

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

    const EMIT_NONE = PhaseRegistry.EMIT_NONE;

    if (this.parent) {
      let hostMap = Component.nodeCache.get(this.parent);
      if (!hostMap) {
        hostMap = new Map<string, Node[]>();
        Component.nodeCache.set(this.parent, hostMap);
      }

      if (this.value) {
        const cachedNodes: Node[] = [];
        if (Array.isArray(this.value)) {
          for (const item of this.value) {
            if (item && typeof item === 'object' && 'type' in item) {
              cachedNodes.push(new Node(item as NodeData, undefined, EMIT_NONE, false));
            }
          }
        } else if (typeof this.value === 'object' && 'type' in this.value) {
          cachedNodes.push(new Node(this.value as NodeData, undefined, EMIT_NONE, false));
        }
        hostMap.set(this.reference, cachedNodes);
        this._instantiatedNodes = [...cachedNodes];
      } else {
        const cachedNodes = hostMap.get(this.reference);
        if (cachedNodes) {
          this._instantiatedNodes = [...cachedNodes];
        }
      }
    }

    if (this.parent && this.parent.isInTree && this.target && phase !== EMIT_NONE) {
      const msg = new WorkerMessage('Component', 'ComponentRoutingWorker');
      msg.addInstruction('createdNew', [this.target || this.reference]);
      this.parent.addMessage(msg);
      Supervisor.emitToPhaseName(this, this.parent, 'componentRouting');
    }
  }

  /**
   * Helper function checking if a component reference has already been applied by an ancestor node in the tree
   * via native children (direct sub-tree descent without crossing placement boundaries).
   *
   * @param node Target Node instance to evaluate.
   * @param component Component binding instance.
   * @returns Boolean indicating if component reference was applied by an ancestor.
   */
  public static isAppliedInAncestors(node: Node, component: Component): boolean {
    if (!node || !component) return false;
    const targetRef = component.reference;
    let resolvedRef = targetRef;
    try {
      const { resolvedBinding } = component.resolveBinding();
      if (resolvedBinding?.reference) resolvedRef = resolvedBinding.reference;
    } catch {
      // Fall back to targetRef if resolution fails
    }

    let isNativeDescendant = true;
    let currNode: Node = node;

    while (currNode.parent) {
      const parentNode = currNode.parent;

      // Check if currNode is a native child of parentNode
      const isNativeChild = Array.isArray(parentNode.nativeChildren) && parentNode.nativeChildren.includes(currNode);
      if (!isNativeChild) {
        isNativeDescendant = false;
      }

      // If not descended strictly through native children (e.g. crossed a placement boundary),
      // placements have their own loop blocker and components updating children can still resolve.
      if (!isNativeDescendant) {
        return false;
      }

      if (parentNode.targetComponents) {
        for (const tc of parentNode.targetComponents.values()) {
          if (tc === component) continue;
          if (tc.reference === targetRef || tc.reference === resolvedRef) {
            return true;
          }
        }
      }


      currNode = parentNode;
    }

    return false;
  }

  /**
   * Builds single-property NodeLayer objects for this component's target modifications.
   *
   * @param phase Execution phase ID.
   * @param target Target property path.
   */
  public buildLayerMap(phase: number, target: string): void {
    this.layerMap.clear();
    const effectiveTarget = target || this.target;
    const sourceName = `component:${effectiveTarget || this.reference}`;
    const targetProp = effectiveTarget || 'type';

    if (targetProp === 'content') {
      if (this._instantiatedNodes && this._instantiatedNodes.length > 0) {
        this.layerMap.set('children', new NodeLayer('children', sourceName, 'replace', this._instantiatedNodes, phase));
      } else if (this.value !== undefined && this.value !== null) {
        this.layerMap.set('content', new NodeLayer('content', sourceName, 'replace', String(this.value), phase));
      }
      return;
    }

    if (targetProp === 'handlers') {
      if (this.value !== undefined && this.value !== null) {
        const rawHandlers = Array.isArray(this.value) ? this.value : [this.value];
        const validHandlers: Handler[] = [];
        for (const item of rawHandlers) {
          if (item instanceof Handler) {
            validHandlers.push(item);
          } else if (item && typeof item === 'object' && ('body' in item || 'event' in item || 'phase' in item)) {
            validHandlers.push(Handler.fromDef(item as any, this.parent, phase));
          } else {
            console.warn(`[Component] Type check failed for target 'handlers': Expected Handler or HandlerDef on component '${this.reference}'`, item);
          }
        }
        if (validHandlers.length > 0) {
          this.layerMap.set('handlers', new NodeLayer('handlers', sourceName, 'replace', validHandlers, phase));
        }
      }
      return;
    }

    if (targetProp === 'component') {
      if (this.value !== undefined && this.value !== null) {
        const rawComps = Array.isArray(this.value) ? this.value : [this.value];
        const validComponents: Component[] = [];
        for (const item of rawComps) {
          if (item instanceof Component) {
            validComponents.push(item);
          } else if (item && typeof item === 'object' && ('reference' in item || 'target' in item)) {
            validComponents.push(new Component(item as any, this.parent, phase));
          } else {
            console.warn(`[Component] Type check failed for target 'component': Expected Component or ComponentBinding on component '${this.reference}'`, item);
          }
        }
        if (validComponents.length > 0) {
          this.layerMap.set('component', new NodeLayer('component', sourceName, 'replace', validComponents, phase));
        }
      }
      return;
    }

    if (this._instantiatedNodes && this._instantiatedNodes.length > 0) {
      if (targetProp === 'type') {
        const protoNode = this._instantiatedNodes[0];
        if (protoNode) {
          this.layerMap.set('type', new NodeLayer('type', sourceName, 'replace', protoNode.type, phase));
          if (protoNode.props) {
            const isAutoId = protoNode.props.isIdAutoGenerated;
            for (const [pKey, pVal] of Object.entries(protoNode.props)) {
              if (pKey === 'parent' || pKey === '_isIdAutoGenerated') continue;
              if (pKey === 'id' && isAutoId) continue;
              if (pVal !== undefined) {
                const layerKey = `props.${pKey}`;
                this.layerMap.set(layerKey, new NodeLayer(layerKey, sourceName, 'replace', pVal, phase));
              }
            }
          }
          if (protoNode.css) {
            const isAutoId = protoNode.props?.isIdAutoGenerated;
            if (protoNode.css.id !== undefined && !isAutoId) {
              this.layerMap.set('css.id', new NodeLayer('css.id', sourceName, 'replace', protoNode.css.id, phase));
            }
            if (protoNode.css.classes !== undefined) {
              this.layerMap.set('css.classes', new NodeLayer('css.classes', sourceName, 'replace', protoNode.css.classes, phase));
            }
            if (protoNode.css.style !== undefined && typeof protoNode.css.style === 'object') {
              for (const [sKey, sVal] of Object.entries(protoNode.css.style)) {
                if (sVal !== undefined) {
                  const layerKey = `css.style.${sKey}`;
                  this.layerMap.set(layerKey, new NodeLayer(layerKey, sourceName, 'replace', sVal, phase));
                }
              }
            }
            if (protoNode.css.styleNodes !== undefined && protoNode.css.styleNodes.length > 0) {
              this.layerMap.set('css.styleNodes', new NodeLayer('css.styleNodes', sourceName, 'replace', protoNode.css.styleNodes, phase));
            }
          }
          if (protoNode.content !== undefined) {
            this.layerMap.set('content', new NodeLayer('content', sourceName, 'replace', protoNode.content, phase));
          }
          const protoChildren = protoNode.children || protoNode.nativeChildren;
          if (protoChildren && protoChildren.length > 0) {
            this.layerMap.set('children', new NodeLayer('children', sourceName, 'replace', protoChildren, phase));
          }
          if (protoNode.handlers && protoNode.handlers.length > 0) {
            this.layerMap.set('handlers', new NodeLayer('handlers', sourceName, 'replace', [...protoNode.handlers], phase));
          }
          if (protoNode.placement && protoNode.placement.length > 0) {
            this.layerMap.set('placement', new NodeLayer('placement', sourceName, 'replace', [...protoNode.placement], phase));
          }
          if (protoNode.component && protoNode.component.length > 0) {
            this.layerMap.set('component', new NodeLayer('component', sourceName, 'replace', [...protoNode.component], phase));
          }
        }
      } else if (targetProp === 'children') {
        this.layerMap.set('children', new NodeLayer('children', sourceName, 'replace', this._instantiatedNodes, phase));
      }
    } else if (this.value !== undefined && this.value !== null) {
      this.layerMap.set(targetProp, new NodeLayer(targetProp, sourceName, 'replace', this.value, phase));
    }
  }

  /**
   * Merges incoming component bindings into a target Node.
   *
   * @param targetNode Target Node instance.
   * @param incomingComponents Array of component bindings or Component objects.
   * @returns Next phase ID (2 for ComponentRoutingWorker) or undefined on lock failure.
   */
  public static mergeComponents(targetNode: Node, incomingComponents: ComponentBinding[] | Component[]): number | undefined {
    if (Supervisor.isPhaseLocked(4) || Supervisor.isPropertyLocked('component')) {
      console.error(`[Component] Lock violation: Component assembly locked for node ${targetNode.css?.id || 'unknown'}`);
      return undefined;
    }

    const componentInstances = incomingComponents.map(c => c instanceof Component ? c : new Component(c, targetNode, 0));
    targetNode.setComponents(componentInstances, 0);

    const targetOrRefNames = componentInstances.map(c => c.target || c.reference).filter(Boolean);
    const msg = new WorkerMessage('Component.mergeComponents', 'ComponentRoutingWorker');
    msg.addInstruction('createdNew', targetOrRefNames);
    targetNode.addMessage(msg);

    return PhaseRegistry.getPhaseNumber('componentRouting');
  }

  /**
   * Clones this Component binding instance, shallow-copying cached node references.
   *
   * @param ignoreProps Array of property keys to exclude from cloning.
   * @param newParent Target host Node instance.
   * @param phase Execution phase ID.
   * @param _actor Optional calling component/worker identifier.
   * @returns Cloned Component instance.
   */
  public clone(ignoreProps: string[] = [], newParent: Node, phase: number, _actor: string = 'Component'): Component {
    const targetPhase = phase;
    const cloned = new Component({
      reference: this.reference,
      target: this.target,
      value: this.value,
    }, newParent, targetPhase, false);

    if (!ignoreProps.includes('_sourceComponent') && this.sourceComponent) {
      cloned.sourceComponent = this.sourceComponent;
    }

    if (!ignoreProps.includes('_referencingNodes') && this._referencingNodes) {
      cloned._referencingNodes = new Set(this._referencingNodes);
    }
    // Shallow copy cached reference array
    if (!ignoreProps.includes('_instantiatedNodes') && this._instantiatedNodes) {
      cloned._instantiatedNodes = [...this._instantiatedNodes];
    }
    if (!ignoreProps.includes('_clonedChildren') && this._clonedChildren) {
      cloned._clonedChildren = [...this._clonedChildren];
    }

    return cloned;
  }

  /**
   * Resolves component reference payload by searching up the virtual DOM tree.
   *
   * @returns Object containing resolvedValue payload and resolvedBinding source Component instance.
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
   * @useCase Slot component expansion during SlotAssemblyWorker execution.
   */
  public cloneNode(referencingNode: any, phase: number): any[] {
    this._referencingNodes.add(referencingNode);

    if (!this._clonedChildren) this._clonedChildren = [];
    if (!this._instantiatedNodes || this._instantiatedNodes.length === 0) return [];

    const targetPhase = phase;
    const clones = this._instantiatedNodes.map(node => node.clone([], ['element', '_referencingNodes'], referencingNode, targetPhase));

    this._clonedChildren.push(...clones);
    return clones;
  }

  /**
   * Destroys component binding and releases applied layers and cached nodes.
   *
   * @useCase Component cleanup during node deletion or dynamic component removal.
   * @processFlow Removes applied property layers, unlinks source/referencing node references, and deletes cached prototype nodes.
   */
  public delete(): void {
    const sourceName = `component:${this.target || this.reference}`;
    if (this.parent && typeof this.parent.removeLayer === 'function') {
      for (const targetProp of this.layerMap.keys()) {
        this.parent.removeLayer(targetProp, sourceName);
      }
    }

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

    if (this.parent) {
      const hostMap = Component.nodeCache.get(this.parent);
      if (hostMap) {
        const cached = hostMap.get(this.reference);
        if (cached) {
          for (const node of cached) {
            node.delete();
          }
          hostMap.delete(this.reference);
        }
        if (hostMap.size === 0) {
          Component.nodeCache.delete(this.parent);
        }
      }
    }

    this._instantiatedNodes = [];
    if (this._clonedChildren) {
      for (const node of this._clonedChildren) {
        node.delete();
      }
      this._clonedChildren = [];
    }
  }
}


