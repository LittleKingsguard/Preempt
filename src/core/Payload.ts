import type { ContentPayload, UserData } from "../types/NodeSchema.js";
import { CloneUtils } from "./utils/CloneUtils.js";
import { Component } from "./Component.js";
import { Node } from "./Node.js";

export class Payload implements ContentPayload {
  public metadata?: Record<string, any> | undefined;
  public userData?: UserData | undefined;
  public component?: Component[] | undefined;
  public content: Node[];

  constructor(data: Partial<ContentPayload>) {
    this.metadata = data.metadata ? CloneUtils.deepClone(data.metadata) : undefined;
    this.userData = data.userData ? CloneUtils.deepClone(data.userData) : undefined;
    
    const passedComponents = data.component;
    const rawContent = data.content || [];

    if (passedComponents && passedComponents.length > 0) {
      rawContent.forEach(item => {
        if (item && !(item instanceof Node)) {
          if (!item.component) item.component = [];
          passedComponents.forEach(pc => {
            const binding = pc instanceof Component 
              ? { reference: pc.reference, target: pc.target, value: pc.value } 
              : pc;
            if (!item.component!.some(c => c && c.reference === binding.reference && c.target === binding.target)) {
              item.component!.push({ ...binding });
            }
          });
        }
      });
    }

    this.content = rawContent.map(item => item instanceof Node ? item : new Node(item, undefined, 0));
  }

  public clone(ignoreProps: string[] = []): Payload {
    return new Payload({
      metadata: ignoreProps.includes('metadata') ? undefined : this.metadata,
      userData: ignoreProps.includes('userData') ? undefined : this.userData,
      component: ignoreProps.includes('component') ? undefined : this.component?.map(c => ({ reference: c.reference, target: c.target, value: c.value })),
      content: ignoreProps.includes('content') ? [] : this.content.map(n => n.clone(ignoreProps, [], null, 99))
    });
  }

  public toString(): string {
    return this.content
      .filter(c => c.type === 'text' || !c.type)
      .map(c => c.content || '')
      .join('');
  }
}
