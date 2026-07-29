import { StyleNode } from "./StyleNode.js";
import type { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

/**
 * Encapsulates styling configuration (ID, CSS classes, inline style object, and nested `StyleNode` definitions) for a Node.
 *
 * @useCase Attached to `node.css` to store styling properties and generate dynamic stylesheet rules.
 * @processFlow Processed in Phase 6/7 (`ClientElementCreationWorker`/`SSRElementCreationWorker`) to output scoped CSS rules.
 */
export class Css {
  /** CSS element ID attribute. */
  public id?: string | undefined;
  /** Array of CSS class names. */
  public classes?: string[] | undefined;
  /** Inline CSS properties dictionary. */
  public style?: Record<string, string> | undefined;
  /** Array of nested StyleNode rule definitions. */
  public styleNodes: StyleNode[] = [];

  /**
   * Constructs a new Css container instance.
   *
   * @param data Initial CSS schema payload.
   * @param node Host Node instance.
   */
  constructor(data: any = {}, node?: Node) {
    this.id = data.id;
    this.classes = data.classes ? [...data.classes] : undefined;
    this.style = data.style ? { ...data.style } : undefined;
    if (data.cssDef && node) {
      for (const def of data.cssDef) {
        this.styleNodes.push(new StyleNode(def, node));
      }
    }
  }

  /**
   * Merges incoming CSS property values into this instance.
   *
   * @param otherCss Incoming Css instance or property payload.
   * @returns Target phase ID 5 or undefined on property lock violation.
   */
  public merge(otherCss: Css | Record<string, any>): number | undefined {
    if (Supervisor.isPropertyLocked('css')) {
      console.error(`[Css] Lock violation: Property 'css' is currently locked`);
      return undefined;
    }
    const other = otherCss instanceof Css ? otherCss : new Css(otherCss);
    if (other.id !== undefined) this.id = other.id;
    if (other.classes !== undefined && Array.isArray(other.classes)) {
      this.classes = [...other.classes];
    }
    if (other.style !== undefined && typeof other.style === 'object') {
      this.style = { ...(this.style || {}), ...other.style };
    }
    if (other.styleNodes && other.styleNodes.length > 0) {
      for (const newSN of other.styleNodes) {
        const existingIdx = this.styleNodes.findIndex(s => s.data?.selector && s.data.selector === newSN.data?.selector);
        if (existingIdx !== -1) {
          this.styleNodes[existingIdx]?.delete();
          this.styleNodes[existingIdx] = newSN;
        } else {
          this.styleNodes.push(newSN);
        }
      }
    }
    return 5;
  }

  /**
   * Deep clones this Css container.
   *
   * @param ignoreProps Property keys to ignore during cloning.
   * @param node Host Node instance.
   * @returns Cloned Css instance.
   */
  public clone(ignoreProps: string[] = [], node?: Node): Css {
    const cloned = new Css({
      id: ignoreProps.includes('id') ? undefined : this.id,
      classes: ignoreProps.includes('classes') ? undefined : this.classes,
      style: ignoreProps.includes('style') ? undefined : this.style
    });
    if (!ignoreProps.includes('styleNodes') && node) {
      for (const sNode of this.styleNodes) {
        cloned.styleNodes.push(sNode.clone(node));
      }
    }
    return cloned;
  }

  /**
   * Destroys all associated StyleNodes.
   */
  public delete(): void {
    if (this.styleNodes) {
      for (const sNode of this.styleNodes) {
        sNode.delete();
      }
      this.styleNodes = [];
    }
  }
}

