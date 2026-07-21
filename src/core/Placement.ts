import type { PlacementConfig } from "../types/NodeSchema.js";
import { Node } from "./Node.js";

export class Placement implements PlacementConfig {
  public static placementArray: Placement[] = [];
  public static sourcePlacements: Record<string, Placement[]> = {};

  public static clearPlacements(): void {
    Placement.placementArray = [];
    Placement.sourcePlacements = {};
  }

  public placementName?: string | undefined;
  public targetPlacement?: string[] | undefined;
  public _referencingNodes?: Set<any> | undefined;
  public parent: Node;

  constructor(data: PlacementConfig, parent: Node) {
    this.parent = parent;
    this.placementName = data.placementName;
    this.targetPlacement = data.targetPlacement ? [...data.targetPlacement] : undefined;
    if (data._referencingNodes) this._referencingNodes = new Set(data._referencingNodes);
  }

  public clone(ignoreProps: string[] = [], newParent: Node): Placement {
    return new Placement({
      placementName: ignoreProps.includes('placementName') ? undefined : this.placementName,
      targetPlacement: ignoreProps.includes('targetPlacement') ? undefined : this.targetPlacement,
      _referencingNodes: ignoreProps.includes('_referencingNodes') ? undefined : (this._referencingNodes ? new Set(this._referencingNodes) : undefined)
    }, newParent);
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

    const clonedNode = node.clone();
    clonedNode.parent = this.parent;
    this.parent.invalidateChildrenCache();

    if (!this._referencingNodes) this._referencingNodes = new Set();
    this._referencingNodes.add(clonedNode);
  }

  public append(): void {
    if (!this.parent) return;

    if (this.placementName && !Placement.placementArray.includes(this)) {
      Placement.placementArray.push(this);

      const newPlacement = this.placementName;
      const referencingPlacements = Placement.sourcePlacements[newPlacement] || [];
      for (const ref of referencingPlacements) {
        ref.parent.receiveNextState({}, 1);
      }
    }
    if (this.targetPlacement) {
      for (const target of this.targetPlacement) {
        if (!Placement.sourcePlacements[target]) {
          Placement.sourcePlacements[target] = [];
        }
        if (!Placement.sourcePlacements[target].includes(this)) {
          Placement.sourcePlacements[target].push(this);
        }
      }
    }
  }

  public delete(): void {
    if (this.parent) {
      const pIndex = Placement.placementArray.indexOf(this);
      if (pIndex > -1) {
        Placement.placementArray.splice(pIndex, 1);
      }
    }

    if (this.placementName) {
      const referencingPlacements = Placement.sourcePlacements[this.placementName] || [];
      for (const ref of referencingPlacements) {
        ref.parent.receiveNextState({}, 1);
      }
      delete Placement.sourcePlacements[this.placementName];
    }

    if (this._referencingNodes) {
      for (const clonedNode of this._referencingNodes) {
        clonedNode.delete();
      }
      this._referencingNodes.clear();
    }
  }
}
