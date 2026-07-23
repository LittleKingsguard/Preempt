import { StyleNode } from "./StyleNode.js";
import type { Node } from "./Node.js";

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
