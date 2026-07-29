import type { ContentPayload, UserData } from "../types/NodeSchema.js";
import { CloneUtils } from "./utils/CloneUtils.js";
import { Component } from "./Component.js";
import { Node } from "./Node.js";

/**
 * Encapsulates dynamic content payload data injected into Supervisor placements.
 *
 * @useCase Contains content nodes, component bindings, user metadata, and batch labels for page injection.
 * @processFlow Passed into `Supervisor.process()` or `Supervisor.injectContent()`.
 */
export class Payload implements ContentPayload {
  /** Metadata key-value dictionary. */
  public metadata?: Record<string, any> | undefined;
  /** User profile/session data object. */
  public userData?: UserData | undefined;
  /** Array of component bindings accompanying the content nodes. */
  public component?: Component[] | undefined;
  /** Array of content Node instances. */
  public content: Node[];

  /**
   * Constructs a new Payload container instance.
   *
   * @param data Raw ContentPayload schema object.
   */
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

  /**
   * Deep clones this Payload object.
   *
   * @param ignoreProps Property keys to exclude.
   * @returns Cloned Payload instance.
   */
  public clone(ignoreProps: string[] = []): Payload {
    return new Payload({
      metadata: ignoreProps.includes('metadata') ? undefined : this.metadata,
      userData: ignoreProps.includes('userData') ? undefined : this.userData,
      component: ignoreProps.includes('component') ? undefined : this.component?.map(c => ({ reference: c.reference, target: c.target, value: c.value })),
      content: ignoreProps.includes('content') ? [] : this.content.map(n => n.clone(ignoreProps, [], null, 99))
    });
  }

  /**
   * Serializes this live Payload instance back to a raw ContentPayload schema object.
   *
   * @returns Raw ContentPayload schema object.
   */
  public toJSON(): ContentPayload {
    return {
      metadata: this.metadata,
      userData: this.userData,
      component: this.component?.map(c => ({ reference: c.reference, target: c.target, value: c.value })),
      content: this.content.map(n => typeof n.exportToJson === 'function' ? n.exportToJson() : n.data)
    };
  }

  /**
   * Export JSON representation matching ContentPayload schema.
   *
   * @returns Raw ContentPayload schema object.
   */
  public exportToJson(): ContentPayload {
    return this.toJSON();
  }

  /**
   * Concatenates and returns text content across contained nodes.
   *
   * @returns Concatenated text content string.
   */
  public toString(): string {
    return this.content
      .filter(c => c.type === 'text' || !c.type)
      .map(c => c.content || '')
      .join('');
  }
}

