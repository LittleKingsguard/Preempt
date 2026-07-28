import type { ComponentBinding, TemplateData } from "../types/NodeSchema.js";
import { Node } from "./Node.js";

function deduplicateComponents(components: (ComponentBinding | any)[]): ComponentBinding[] {
  const map = new Map<string, ComponentBinding>();
  for (const c of components) {
    if (!c) continue;
    const ref = c.reference || (c.sourceComponent ? c.sourceComponent.reference : '');
    const target = c.target || '';
    const key = `${ref}::${target}`;
    if (!map.has(key) || (c.value !== undefined && map.get(key)?.value === undefined)) {
      map.set(key, c);
    }
  }
  return Array.from(map.values());
}

/**
 * Represents the root layout template tree (`TemplateData`) in Preempt.
 *
 * @useCase Encapsulates root node layout, template child nodes, and component definitions.
 * @processFlow Created at startup/SSR request and passed to `Supervisor.process()`.
 */
export class Template {
  /** Root virtual DOM Node instance of the template layout tree. */
  public root: Node;
  /** Direct native child Node instances. */
  public children: Node[];
  /** Array of component bindings defined at the template level. */
  public component: ComponentBinding[];

  /**
   * Constructs a new Template instance.
   *
   * @param data TemplateData JSON schema.
   */
  constructor(data: TemplateData) {
    const rootData = data.root;
    const templateComponents = [
      ...(Array.isArray(data.component) ? data.component : []),
      ...(rootData && Array.isArray(rootData.component) ? rootData.component : [])
    ];
    this.component = deduplicateComponents(templateComponents);

    if (rootData) {
      rootData.component = this.component;
    }

    const rootNode = new Node(rootData, null, 0, true);

    const childrenData = Array.isArray(data.children) ? data.children : [];
    const childNodes = childrenData.map((c: any) => c instanceof Node ? c : new Node(c, undefined, 0, false));

    this.root = rootNode;
    this.children = childNodes;
  }

  /**
   * Clones this Template.
   *
   * @param ignoreProps Property exclusion list.
   * @returns Cloned Template instance.
   */
  public clone(ignoreProps: string[] = []): Template {
    const clonedRoot = this.root.clone(ignoreProps, [], null, 99);
    const clonedChildren = this.children.map(c => c.clone(ignoreProps, [], null, 99));
    const clonedComponents = this.component.map(c => typeof (c as any).clone === 'function' ? (c as any).clone(ignoreProps, clonedRoot, 99) : c);

    const cloned = new Template({
      root: clonedRoot,
      children: clonedChildren,
      component: clonedComponents
    });
    return cloned;
  }

  /**
   * Exports clean TemplateData JSON structure.
   *
   * @returns Clean TemplateData object.
   */
  public exportToJson(): TemplateData {
    const json: TemplateData = {
      root: this.root.exportToJson(),
      children: this.children.map(c => typeof c.exportToJson === 'function' ? c.exportToJson() : (c as any).data)
    };
    if (this.component && this.component.length > 0) {
      json.component = deduplicateComponents(this.component);
    }
    return json;
  }

  /** Alias for `exportToJson()`. */
  public toJSON(): TemplateData {
    return this.exportToJson();
  }
}

