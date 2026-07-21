import type { ContentPayload, NodeData, UserData } from "../types/NodeSchema.js";
import { CloneUtils } from "./utils/CloneUtils.js";
import { Component } from "./Component.js";
import { Node } from "./Node.js";

export class Payload implements ContentPayload {
  public metadata?: Record<string, any>;
  public userData?: UserData;
  public component?: Component[];
  public content: NodeData[];

  constructor(data: Partial<ContentPayload> | string | NodeData | NodeData[], parent?: Node) {
    if (typeof data === 'string') {
      this.content = [{ type: 'text', content: data }];
    } else if (Array.isArray(data)) {
      this.content = CloneUtils.deepClone(data);
    } else if (data && typeof data === 'object' && ('type' in data) && !('content' in data && Array.isArray((data as any).content) && (data as any).type === undefined)) {
      // It's a NodeData object
      this.content = [CloneUtils.deepClone(data)];
    } else {
      // It's a ContentPayload object
      const payload = data as Partial<ContentPayload>;
      this.metadata = payload.metadata ? CloneUtils.deepClone(payload.metadata) : undefined;
      this.userData = payload.userData ? CloneUtils.deepClone(payload.userData) : undefined;
      this.component = payload.component ? payload.component.map(c => {
        if (!parent) throw new Error("Parent node is required to initialize components in Content");
        return new Component(c, parent);
      }) : undefined;
      this.content = payload.content ? CloneUtils.deepClone(payload.content) : [];
    }
  }

  public clone(ignoreProps: string[] = [], newParent?: Node): Payload {
    return new Payload({
      metadata: ignoreProps.includes('metadata') ? undefined : this.metadata,
      userData: ignoreProps.includes('userData') ? undefined : this.userData,
      component: ignoreProps.includes('component') ? undefined : this.component?.map(c => {
        if (!newParent) throw new Error("New parent node is required to clone components in Content");
        return c.clone(ignoreProps, newParent);
      }),
      content: ignoreProps.includes('content') ? [] : this.content
    }, newParent);
  }

  public assembleContentNodes(parent?: Node): Node[] {
    const nodes: Node[] = [];
    for (const data of this.content) {
      nodes.push(new Node(data, parent));
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
