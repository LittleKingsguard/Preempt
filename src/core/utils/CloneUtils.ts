import { Node } from "../Node.js";

/**
 * Utility class providing cycle-safe object cloning for raw data structures and state payloads across Preempt.
 *
 * @useCase Used during Phase 0 (`InstantiationWorker`) and pipeline operations to clone component binding data, raw JSON objects, and state snapshots without infinite loops.
 * @processFlow Invoked when copying raw node data structures, component values, or pipeline state snapshots.
 * @note **Important Usage Restriction**: `CloneUtils` should NOT be used directly to duplicate live class objects (e.g. `Node`, `Component`, `Handler`, `Placement`, `StyleNode`, `Props`, `Css`). Live class objects must be duplicated via their dedicated `.clone()` instance methods to ensure proper tree linkages, parent references, and render pipeline event emissions.
 */
export class CloneUtils {
  private static readonly CLONE_IGNORE_KEYS = new Set([
    '_lastValidState', 'element', 'node',
    '_instantiatedNodes', '_referencingNodes', 'parent', 'nativeChildren', 'originalParent'
  ]);

  /**
   * Safely deep clones a raw value or data structure using cycle detection (`WeakSet`) and property filtering.
   * Delegates to `val.clone()` if a `.clone()` method exists on the target.
   *
   * @param val Target object, array, or data structure to clone.
   * @param shallowKeys Keys that should be copied by reference rather than deep cloned.
   * @param ignoreKeys Keys that should be excluded/ignored during cloning.
   * @returns Deep cloned copy of the value, or original value on cycle detection fallback.
   * @useCase Deep cloning component values, JSON schemas, and raw state payloads safely.
   * @processFlow Phase 0 Instantiation & Component assembly.
   */
  public static deepClone(val: any, shallowKeys: string[] = [], ignoreKeys: Iterable<string> = CloneUtils.CLONE_IGNORE_KEYS): any {
    if (val === undefined) return undefined;

    if (val !== null && typeof val === 'object' && typeof val.clone === 'function') {
      if (val instanceof Node) {
        return val.clone(Array.from(ignoreKeys), shallowKeys, null, val.lastCompletedPhase || 99);
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

