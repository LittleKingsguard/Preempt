import type { PlacementConfig } from "../types/NodeSchema.js";
import type { Node } from "./Node.js";

export class Placement implements PlacementConfig {
  public static placementArray: Node[] = [];
  public static sourcePlacements: Record<string, Node[]> = {};

  public static clearPlacements(): void {
    Placement.placementArray = [];
    Placement.sourcePlacements = {};
  }

  public placementName?: string;
  public targetPlacement?: string[];
  public _referencingNodes?: Set<any>;
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

    if (node.parent) {
      node.originalParent = node.parent;
      node.originalIndex = node.parent.nativeChildren.indexOf(node);
      if (node.originalIndex > -1) {
        node.parent.nativeChildren.splice(node.originalIndex, 1);
        node.parent.invalidateChildrenCache();
      }
    }
    node.parent = this.parent;
    node.wasPlaced = true;
    this.parent.invalidateChildrenCache();

    if (!this._referencingNodes) this._referencingNodes = new Set();
    this._referencingNodes.add(node);
  }
  public append(): void {
    if (!this.parent) return;

    if (this.placementName && !Placement.placementArray.includes(this.parent)) {
      Placement.placementArray.push(this.parent);

      const newPlacement = this.placementName;
      const referencingNodes = Placement.sourcePlacements[newPlacement] || [];
      for (const ref of referencingNodes) {
        ref.receiveNextState({ activePlacement: undefined }, 1);
      }
    }
    if (this.targetPlacement) {
      for (const target of this.targetPlacement) {
        if (!Placement.sourcePlacements[target]) {
          Placement.sourcePlacements[target] = [];
        }
        if (!Placement.sourcePlacements[target].includes(this.parent)) {
          Placement.sourcePlacements[target].push(this.parent);
        }
      }
    }
  }


  public delete(): void {
    if (this.parent) {
      const pIndex = Placement.placementArray.indexOf(this.parent);
      if (pIndex > -1) {
        Placement.placementArray.splice(pIndex, 1);
      }
    }
    
    if (this.placementName) {
      const referencingNodes = Placement.sourcePlacements[this.placementName] || [];
      for (const ref of referencingNodes) {
        ref.receiveNextState({ activePlacement: undefined }, 1);
      }
      delete Placement.sourcePlacements[this.placementName];
    }
    
    if (this._referencingNodes) {
      this._referencingNodes.clear();
    }
  }
}
