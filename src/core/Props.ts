import type { Node } from "./Node.js";
import { CloneUtils } from "./utils/CloneUtils.js";

export class Props {
  public parent?: Node;
  [key: string]: any;

  constructor(data: Record<string, any> = {}, parent?: Node) {
    Object.defineProperty(this, 'parent', {
      value: parent,
      enumerable: false,
      writable: true,
      configurable: true
    });
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'parent') {
        this[key] = CloneUtils.deepClone(value);
      }
    }
  }

  public clone(ignoreProps: string[] = [], newParent?: Node): Props {
    const parentNode = newParent || this.parent;
    const propsObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(this)) {
      if (key === 'parent' || ignoreProps.includes(key)) continue;
      propsObj[key] = CloneUtils.deepClone(value);
    }
    return new Props(propsObj, parentNode);
  }
}
