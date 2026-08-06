import type { PlacementConfig } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

/**
 * Manages virtual DOM layout placement slots (`placementName`) and content insertion target definitions (`targetPlacement`).
 *
 * @useCase Attached to template nodes as placement slots or content nodes as placement targets to enable dynamic reparenting and layout composition.
 * @processFlow Resolved in Phase 1 (`PlacementWorker`), reparenting target content nodes into matching layout slot containers.
 */
export class Placement implements PlacementConfig {
  /** Global map of active placement drop-zone names to Placement instances. */
  public static placementMap: Map<string, Placement[]> = new Map<string, Placement[]>();
  /** Global map of target placement request names to Placement instances. */
  public static sourcePlacements: Map<string, Placement[]> = new Map<string, Placement[]>();

  /** Clears all static placement tracking maps. */
  public static clearPlacements(): void {
    Placement.placementMap.clear();
    Placement.sourcePlacements.clear();
  }

  public placementName?: string | undefined;
  public targetPlacement?: string[] | undefined;
  public _referencingNodes: Set<Node> = new Set();
  public parent: Node;

  /**
   * Constructs a new Placement definition.
   *
   * @param data PlacementConfig schema payload.
   * @param parent Host Node instance.
   * @param phase Execution phase ID.
   * @param _isInTree Boolean indicating tree membership.
   */
  constructor(data: PlacementConfig, parent: Node, phase: number, _isInTree?: boolean) {
    this.parent = parent;
    this.placementName = data.placementName;
    this.targetPlacement = data.targetPlacement ? [...data.targetPlacement] : undefined;
    this.append(phase);
  }

  /**
   * Clones this Placement definition.
   *
   * @param ignoreProps Property exclusion list.
   * @param newParent Host Node instance.
   * @param phase Execution phase ID.
   * @returns Cloned Placement instance.
   */
  public clone(ignoreProps: string[] = [], newParent: Node, phase: number, actor: string = 'Placement'): Placement {
    const parentNode = newParent || this.parent;
    const targetPhase = phase;
    const clonedPlacement = new Placement({
      placementName: ignoreProps.includes('placementName') ? undefined : this.placementName,
      targetPlacement: ignoreProps.includes('targetPlacement') ? undefined : this.targetPlacement
    }, parentNode, targetPhase, parentNode.isInTree);

    if (!ignoreProps.includes('_referencingNodes')) {
      for (const refNode of this._referencingNodes) {
        clonedPlacement._referencingNodes.add(refNode.clone(ignoreProps, [], parentNode, targetPhase, false, actor));
      }
    }

    return clonedPlacement;
  }

  /**
   * Places a target Node clone into this host placement container.
   *
   * @param node Target Node instance to clone into container.
   * @returns Cloned Node instance added to tree.
   * @useCase Inserting content nodes into template drop-zones.
   * @processFlow Phase 1 placement mapping.
   */
  public placeInto(node: Node): Node {
    if (this._referencingNodes) {
      for (const ref of this._referencingNodes) {
        if (ref.data === node.data) {
          return ref;
        }
      }
    }

    const clonedNode = node.clone([], [], this.parent, 2, false, 'Placement.placeInto');

    if (this.parent === node) {
      throw new Error("Cannot place node into itself");
    }
    let current: Node | null | undefined = this.parent.parent;
    while (current) {
      if (current === node) {
        throw new Error("Cannot place node into a descendant");
      }
      current = current.parent;
    }

    if (this.parent.element && this.parent.element.style?.display === 'none') {
      const parentCssDisplay = this.parent.css?.style?.['display'] || (this.parent.css as any)?.display;
      if (parentCssDisplay !== 'none') {
        if (parentCssDisplay !== undefined && parentCssDisplay !== null && parentCssDisplay !== '') {
          this.parent.element.style.display = parentCssDisplay;
        } else {
          this.parent.element.style.removeProperty('display');
          if (this.parent.element.style.display === 'none') {
            this.parent.element.style.display = '';
          }
        }
      }
    }

    this._referencingNodes.add(clonedNode);
    const idx = this.parent.nativeChildren.indexOf(clonedNode);
    if (idx !== -1) {
      this.parent.nativeChildren.splice(idx, 1);
    }
    this.parent.invalidateChildrenCache();
    return clonedNode;
  }

  /**
   * Registers this Placement into global tracking maps and emits node to Phase 1 (`PlacementWorker`).
   *
   * @param phase Execution phase ID.
   */
  public append(phase: number): void {
    if (this.placementName) {
      let list = Placement.placementMap.get(this.placementName);
      if (!list) {
        list = [];
        Placement.placementMap.set(this.placementName, list);
      }
      if (!list.includes(this)) {
        list.push(this);

        if (phase === 0) {
          const referencingPlacements = Placement.sourcePlacements.get(this.placementName) || [];
          for (const ref of referencingPlacements) {
            ref.parent.receiveNextState({}, 1);
          }
        }
      }
    }
    if (this.targetPlacement) {
      for (const target of this.targetPlacement) {
        let list = Placement.sourcePlacements.get(target);
        if (!list) {
          list = [];
          Placement.sourcePlacements.set(target, list);
        }
        if (!list.includes(this)) {
          list.push(this);
        }
      }
      if (phase === 0) {
        Supervisor.emitToPhaseName(this, this.parent, {}, 'placement'); // Emit to PlacementWorker (Phase 1)
      }
    }
  }

  /**
   * Unregisters this placement definition and deletes placed child node instances.
   */
  public delete(): void {
    if (this.placementName) {
      const list = Placement.placementMap.get(this.placementName);
      if (list) {
        const idx = list.indexOf(this);
        if (idx > -1) list.splice(idx, 1);
        if (list.length === 0) Placement.placementMap.delete(this.placementName);
      }

      const referencingPlacements = Placement.sourcePlacements.get(this.placementName) || [];
      for (const ref of referencingPlacements) {
        ref.parent.receiveNextState({}, 1);
      }
      Placement.sourcePlacements.delete(this.placementName);
    }

    if (this.targetPlacement) {
      for (const target of this.targetPlacement) {
        const list = Placement.sourcePlacements.get(target);
        if (list) {
          const idx = list.indexOf(this);
          if (idx > -1) list.splice(idx, 1);
          if (list.length === 0) Placement.sourcePlacements.delete(target);
        }
      }
    }

    if (this._referencingNodes) {
      for (const clonedNode of this._referencingNodes) {
        clonedNode.delete();
      }
      this._referencingNodes.clear();
    }
  }
}

