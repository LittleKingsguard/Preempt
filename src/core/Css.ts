import { StyleNode } from "./StyleNode.js";
import type { Node } from "./Node.js";
import { Supervisor } from "./Supervisor.js";

export class Css {
  public id?: string | undefined;
  public classes?: string[] | undefined;
  public style?: Record<string, string> | undefined;
  public styleNodes: StyleNode[] = [];

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
          this.styleNodes[existingIdx].delete();
          this.styleNodes[existingIdx] = newSN;
        } else {
          this.styleNodes.push(newSN);
        }
      }
    }
    return 5;
  }

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

  public delete(): void {
    if (this.styleNodes) {
      for (const sNode of this.styleNodes) {
        sNode.delete();
      }
      this.styleNodes = [];
    }
  }
}
