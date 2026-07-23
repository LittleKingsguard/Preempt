import type { ContentPayload, NodeData, UserData } from "../types/NodeSchema.js";
import { CloneUtils } from "./utils/CloneUtils.js";
import { Component } from "./Component.js";
import { Node } from "./Node.js";

export class Payload implements ContentPayload {
  public metadata?: Record<string, any> | undefined;
  public userData?: UserData | undefined;
  public component?: Component[] | undefined;
  public content: NodeData[];

  constructor(data: Partial<ContentPayload>, parent?: Node) {
    this.metadata = data.metadata ? CloneUtils.deepClone(data.metadata) : undefined;
    this.userData = data.userData ? CloneUtils.deepClone(data.userData) : undefined;
    this.component = data.component ? data.component.map(c => {
      if (!parent) throw new Error("Parent node is required to initialize components in Content");
      return c instanceof Component ? c : new Component(c, parent, 0);
    }) : undefined;
    this.content = data.content ? CloneUtils.deepClone(data.content) : [];
  }

  public clone(ignoreProps: string[] = [], newParent?: Node): Payload {
    return new Payload({
      metadata: ignoreProps.includes('metadata') ? undefined : this.metadata,
      userData: ignoreProps.includes('userData') ? undefined : this.userData,
      component: ignoreProps.includes('component') ? undefined : this.component?.map(c => {
        if (!newParent) throw new Error("New parent node is required to clone components in Content");
        return c.clone(ignoreProps, newParent, 99);
      }),
      content: ignoreProps.includes('content') ? [] : this.content
    }, newParent);
  }

  public assembleContentNodes(_parent?: Node): Node[] {
    const nodes: Node[] = [];
    for (const data of this.content) {
      nodes.push(new Node(data, undefined, 0));
    }
    return nodes;
  }

  public toString(): string {
    return this.content
      .filter(c => c.type === 'text' || !c.type)
      .map(c => typeof c === 'string' ? c : c.content)
      .join('');
  }
}
