import { Node } from "../Node.js";
import type { NodeQuery } from "../../types/NodeSchema.js";

/**
 * Utility engine for matching and querying Virtual DOM Node instances against filter criteria.
 *
 * @useCase Used by `node.findNode()` and `node.findNodes()` in interactive client handlers to locate target UI nodes.
 * @processFlow Invoked during client handler execution or MCP component extraction.
 */
export class NodeQueryUtils {
  /**
   * Tests whether a given Node satisfies a query object or filter predicate.
   *
   * @param node Target Node instance to evaluate.
   * @param query NodeQuery criteria object or custom predicate function.
   * @returns `true` if the node satisfies all query criteria, `false` otherwise.
   * @useCase Matching nodes by ID, type, CSS class, prop values, handlers, or component references.
   * @processFlow Evaluated during tree traversal in `findNode` and `findNodes`.
   */
  public static isMatch(node: Node, query: NodeQuery | ((n: Node) => boolean)): boolean {
    if (typeof query === 'function') {
      return query(node);
    }

    if (query.id && node.css?.id !== query.id) return false;
    if (query.type && node.type !== query.type) return false;

    if (query.classes && query.classes.length > 0) {
      if (!node.css?.classes) return false;
      const hasAllClasses = query.classes.every(c => node.css!.classes!.includes(c));
      if (!hasAllClasses) return false;
    }

    if (query.props) {
      if (!node.props) return false;
      for (const [k, v] of Object.entries(query.props)) {
        if (node.props[k] !== v) return false;
      }
    }

    if (query.style) {
      if (!node.css?.style) return false;
      for (const [k, v] of Object.entries(query.style)) {
        if (node.css.style[k] !== v) return false;
      }
    }

    if (query.handlers) {
      if (!node.handlers || !Array.isArray(node.handlers)) return false;
      for (const [k, v] of Object.entries(query.handlers)) {
        const handlerObj = node.handlers.find(h => h.name === k || h.event === k || h.phase === k);
        if (!handlerObj) return false;
        if (typeof v === 'string' && handlerObj.body !== v) return false;
        if (typeof v !== 'string' && (handlerObj.body !== (v as any).body || handlerObj.name !== (v as any).name)) return false;
      }
    }

    if (query.components && query.components.length > 0) {
      if (!node.component) return false;
      for (const compQuery of query.components) {
        const match = node.component.some(c => {
          if (compQuery.target && c.target !== compQuery.target) return false;
          if (compQuery.reference && c.reference !== compQuery.reference) return false;
          return true;
        });
        if (!match) return false;
      }
    }

    if (query.hasNonTypeTargetComponents) {
      const hasNonTypeTarget =
        (node.targetComponents && Array.from(node.targetComponents.values()).some(c => c.target !== undefined && c.target !== "type")) ||
        (node.component && node.component.some(c => c.target !== undefined && c.target !== "type"));
      if (!hasNonTypeTarget) return false;
    }

    return true;
  }

  /**
   * Recursively searches a node tree and returns all matching Node instances.
   *
   * @param node Root Node of tree branch to search.
   * @param query Criteria object or filter function.
   * @returns Array of all matching Node instances.
   * @useCase Collecting multiple matching form inputs or list items in a component.
   * @processFlow Client handler tree search.
   */
  public static findNodes(node: Node, query: NodeQuery | ((n: Node) => boolean)): Node[] {
    const results: Node[] = [];

    if (NodeQueryUtils.isMatch(node, query)) {
      results.push(node);
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) results.push(...NodeQueryUtils.findNodes(child, query));
      }
    }

    return results;
  }

  /**
   * Recursively searches a node tree and returns the first matching Node instance.
   *
   * @param node Root Node of tree branch to search.
   * @param query Criteria object or filter function.
   * @param depth Current recursion depth counter (defaults to 0).
   * @returns Matching Node instance or `null` if not found.
   * @useCase Finding specific container elements or named inputs in component handlers.
   * @processFlow Client handler tree search.
   */
  public static findNode(node: Node, query: NodeQuery | ((n: Node) => boolean), depth: number = 0): Node | null {
    if (NodeQueryUtils.isMatch(node, query)) {
      return node;
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) {
          const found = NodeQueryUtils.findNode(child, query, depth + 1);
          if (found) return found;
        }
      }
    }

    return null;
  }
}

