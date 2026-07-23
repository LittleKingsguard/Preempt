import type { PlacementConfig } from "../types/NodeSchema.js";
import { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

export class Placement implements PlacementConfig {
  public static placementMap: Map<string, Placement[]> = new Map<string, Placement[]>();
  public static sourcePlacements: Map<string, Placement[]> = new Map<string, Placement[]>();

  public static clearPlacements(): void {
    Placement.placementMap.clear();
    Placement.sourcePlacements.clear();
  }

  public placementName?: string | undefined;
  public targetPlacement?: string[] | undefined;
  public _referencingNodes: Set<Node> = new Set();
  public parent: Node;

  constructor(data: PlacementConfig, parent: Node, phase: number, _isInTree?: boolean) {
    this.parent = parent;
    this.placementName = data.placementName;
    this.targetPlacement = data.targetPlacement ? [...data.targetPlacement] : undefined;
    this.append(phase);
  }

  public clone(ignoreProps: string[] = [], newParent: Node, phase: number): Placement {
    const parentNode = newParent || this.parent;
    const targetPhase = phase;
    const clonedPlacement = new Placement({
      placementName: ignoreProps.includes('placementName') ? undefined : this.placementName,
      targetPlacement: ignoreProps.includes('targetPlacement') ? undefined : this.targetPlacement
    }, parentNode, targetPhase, parentNode.isInTree);

    if (!ignoreProps.includes('_referencingNodes')) {
      for (const refNode of this._referencingNodes) {
        clonedPlacement._referencingNodes.add(refNode.clone(ignoreProps, [], parentNode, targetPhase));
      }
    }

    return clonedPlacement;
  }

  public placeInto(node: Node): void {
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

    const clonedNode = node.clone([], [], this.parent, 2);
    this._referencingNodes.add(clonedNode);
    const idx = this.parent.nativeChildren.indexOf(clonedNode);
    if (idx !== -1) {
      this.parent.nativeChildren.splice(idx, 1);
    }
    this.parent.invalidateChildrenCache();
  }

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
        Supervisor.emitToPhase(this, this.parent, {}, 1); // Emit to PlacementWorker (Phase 1)
      }
    }
  }

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
