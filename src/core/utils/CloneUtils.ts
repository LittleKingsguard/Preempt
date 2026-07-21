import { Node } from "../Node.js";

export class CloneUtils {
  private static readonly CLONE_IGNORE_KEYS = new Set([
    '_lastValidState', 'element', 'node',
    '_instantiatedNodes', '_referencingNodes', 'parent',
    'children', 'nativeChildren', 'originalParent'
  ]);

  public static deepClone(val: any, shallowKeys: string[] = [], ignoreKeys: Iterable<string> = CloneUtils.CLONE_IGNORE_KEYS): any {
    if (val === undefined) return undefined;
    
    if (val !== null && typeof val === 'object' && typeof val.clone === 'function') {
      if (val instanceof Node) {
        return val.clone(Array.from(ignoreKeys), shallowKeys);
      }
      return val.clone();
    }

    const seen = new WeakSet();
    const ignoreSet = ignoreKeys instanceof Set ? ignoreKeys : new Set(ignoreKeys);
    const replacer = (k: string, v: any) => {
      if (shallowKeys.includes(k)) return undefined;
      
      if (ignoreSet.has(k)) return undefined;
      
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined; // Prevent cycle
        seen.add(v);
      }
      return v;
    };
    try {
      const cloned = JSON.parse(JSON.stringify(val, replacer));
      if (val !== null && typeof val === 'object' && cloned !== null && typeof cloned === 'object') {
        for (const key of shallowKeys) {
          if (key in val) cloned[key] = val[key];
        }

      }
      return cloned;
    } catch (e) {
      console.warn("Cycle detected during deepClone, falling back", e);
      return val;
    }
  }
}
