import { Supervisor } from "./Supervisor.js";
import { Node } from "./Node.js";
import { Handler } from "./Handler.js";
import type { NodeData, NodeQuery, ContentPayload } from "../types/NodeSchema.js";
import { Component } from "./Component.js";

export type EventMutationListener = (
  event: Event | { type: string; [key: string]: any },
  targetNode: Node,
  preState: NodeData,
  postState: NodeData
) => void;

/**
 * Client-Side API bridge interface exposed to interactive handlers (`context.clientAPI`).
 *
 * @useCase Provides managed methods for atomic node state modification, fetching dynamic content, compiling handlers, and adding content nodes safely without manual DOM manipulation.
 * @processFlow Invoked within client-side event handlers or lifecycle triggers.
 */
export class ClientAPI {
  /** Map of compiled handler functions cached by name. */
  public handlers: { [key: string]: Function } = {};

  public beforeEventListeners: Set<EventMutationListener> = new Set();
  public afterEventListeners: Set<EventMutationListener> = new Set();

  public addBeforeEventListener(listener: EventMutationListener): void {
    this.beforeEventListeners.add(listener);
  }

  public removeBeforeEventListener(listener: EventMutationListener): void {
    this.beforeEventListeners.delete(listener);
  }

  public addAfterEventListener(listener: EventMutationListener): void {
    this.afterEventListeners.add(listener);
  }

  public removeAfterEventListener(listener: EventMutationListener): void {
    this.afterEventListeners.delete(listener);
  }

  constructor() {}


  /**
   * Reads initial hydration data from `<script id="preempt-initial-data">` element in document HTML.
   *
   * @returns Parsed initial template/content JSON payload or null.
   * @useCase Initial page hydration on client start.
   * @processFlow Browser DOM startup reading initial payload.
   */
  public getInitialData(): any {
    if (typeof document !== 'undefined') {
      const dataElement = document.getElementById('preempt-initial-data');
      if (dataElement) {
        try {
          return JSON.parse(dataElement.textContent || "{}");
        } catch (e) {
          console.error("Failed to parse preempt-initial-data", e);
        }
      }
    }
    return null;
  }

  /**
   * Retrieves or compiles a handler function by name, traversing up the virtual DOM node tree.
   *
   * @param key Handler name or reference key.
   * @param contextNode Virtual DOM Node context to start traversal.
   * @returns Compiled handler function or undefined if not found.
   * @useCase Handler function lookup during event dispatching.
   * @processFlow Virtual DOM tree upward traversal and compilation.
   */
  public getHandler(key: string, contextNode?: Node): Function | undefined {
    let current: Node | null | undefined = contextNode;
    while (current) {
      if (current.handlers && (current.handlers as any)[key] && (current.handlers as any)[key].compiled) {
        return (current.handlers as any)[key].compiled;
      }
      
      const componentBinding = current.sourceComponents?.get(key);
      if (componentBinding) {
        const { resolvedValue } = componentBinding.resolveBinding();
        if (resolvedValue) {
          if (typeof resolvedValue === 'object' && resolvedValue !== null && 'compiled' in resolvedValue) {
            return (resolvedValue as any).compiled;
          }
          if (typeof resolvedValue === 'string') {
            const tempNode = new Node({ type: 'div' }, null, 0);
            if (!tempNode.handlers) tempNode.handlers = [];
            tempNode.handlers.push(new Handler({ name: key, body: resolvedValue }, tempNode, 0));
            return this.getHandler(key, current);
          }
        }
      }
      
      current = current.parent;
    }
    
    if (this.handlers[key]) {
      return this.handlers[key];
    }
    
    console.error(`Handler ${key} not found in tree.`, contextNode);
    return undefined;
  }

  /**
   * Compiles a JavaScript function body string into an executable Function object.
   *
   * @param name Handler identifier string.
   * @param body JavaScript code body string.
   * @returns Executable Function instance or undefined on error.
   * @useCase Dynamic handler compilation at runtime.
   */
  public compileHandler(name: string, body: string): Function | undefined {
    try {
      const trimmedValue = body.trim();
      if (trimmedValue.startsWith('(') || trimmedValue.startsWith('async (')) {
        return new Function('return ' + trimmedValue)();
      } else {
        return new Function('event', 'context', trimmedValue);
      }
    } catch (err) {
      console.error(`Failed to compile handler ${name}`, err);
    }
  }

  /**
   * Fetches remote content nodes from server API, attaches placements, and injects into active Supervisor stream.
   *
   * @param options Fetch options containing endpoint URL, batch label, node query, default template, and target placement names.
   * @param next Optional callback function executed after injection completes.
   * @returns Promise resolving when content injection is completed.
   * @useCase Dynamic tab loading, dynamic listing pagination, and remote widget injection.
   * @processFlow HTTP fetch -> payload normalization -> placement attachment -> `Supervisor.injectContent()`.
   */
  async fetchContent(
    options: { url: string, batchLabel: string, query: NodeQuery, defaultTemplate?: NodeData, placements: string[] },
    next?: () => void
  ): Promise<void> {
    Supervisor.clearLockedPhases();
    const queryParams = new URLSearchParams(options.query as any).toString();
    const queryURL = queryParams ? `${options.url}?${queryParams}` : options.url;
    const response = await fetch(queryURL, { method: "GET", headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    const data = await response.json();
    let contentPayload: ContentPayload;

    if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.content)) {
      contentPayload = {
        metadata: data.metadata ? { ...data.metadata } : {},
        userData: data.userData,
        component: data.component ? [...data.component] : [],
        content: [...data.content]
      };
    } else {
      let rawItems: NodeData[] = [];
      let extraComponents: any[] = [];
      if (Array.isArray(data)) {
        rawItems = data.flatMap((item: any) => {
          if (item && typeof item === 'object') {
            if (item.component && Array.isArray(item.component)) extraComponents.push(...item.component);
            if (Array.isArray(item.content)) return item.content;
          }
          return [item];
        });
      } else if (data && typeof data === 'object') {
        if (data.component && Array.isArray(data.component)) extraComponents.push(...data.component);
        if (Array.isArray(data.content)) {
          rawItems = data.content;
        } else {
          rawItems = [data];
        }
      } else {
        rawItems = [data];
      }
      contentPayload = {
        metadata: {},
        component: extraComponents,
        content: rawItems
      };
    }

    contentPayload.content.forEach((item: NodeData) => {
      if (!item.props) item.props = {};
      item.props.batchLabel = options.batchLabel;

      if (!item.placement) {
        item.placement = [{ targetPlacement: [...options.placements] }];
      } else {
        if (item.placement.length === 0) {
          item.placement.push({ targetPlacement: [...options.placements] });
        } else {
          item.placement.forEach(p => {
            if (!p.targetPlacement) p.targetPlacement = [];
            p.targetPlacement.push(...options.placements);
          });
        }
      }
    });

    if (Supervisor.instance) {
      if (!Supervisor.instance.contentData) {
        Supervisor.instance.contentData = new Set();
      }
      
      await Supervisor.injectContent(contentPayload);
    }

    if (next) {
      next();
    }
  }

  /**
   * Applies an atomic partial state update to a target Node instance.
   *
   * @param partialNode Partial state object containing updated node properties.
   * @param targetNode Target Node instance to update.
   * @param next Optional callback function executed after update.
   * @param _persistent Optional persistence flag.
   * @returns Promise resolving when state update is enqueued.
   * @useCase Applying runtime state mutations to virtual DOM nodes.
   * @processFlow Passes `nextState` to `targetNode.receiveNextState()`, enqueuing update for `ClientElementCreationWorker`.
   */
  async modifyNode(
    partialNode: Partial<Node>,
    targetNode: Node,
    next?: () => void,
    _persistent?: boolean
  ): Promise<void> {
    const nextState: any = {};
    const nodeKeys = ['type', 'content', 'css', 'props', 'handlers', 'component', 'placement', 'versions'];
    for (const key of nodeKeys) {
      if (key in partialNode) {
        nextState[key] = (partialNode as any)[key];
      }
    }

    targetNode.receiveNextState(nextState);

    if (next) next();
  }

  /**
   * Inject new content nodes with a batch ID directly into the Supervisor content stream.
   *
   * @param nodes Single NodeData object or array of NodeData objects.
   * @param batchId Batch identifier label string.
   * @param next Optional callback function executed after injection.
   * @returns Promise resolving when injection completes.
   * @useCase Dynamically appending new UI component rows or items.
   * @processFlow Wraps nodes into ContentPayload and calls `Supervisor.injectContent()`.
   */
  async addContentNodes(nodes: any | any[], batchId: string, next?: () => void): Promise<void> {
    const nodeArray = Array.isArray(nodes) ? nodes : [nodes];
    if (Supervisor.instance) {
      const newPayload: ContentPayload = {
        metadata: { batchLabel: batchId },
        content: nodeArray,
        component: []
      };
      await Supervisor.injectContent(newPayload);
    }

    if (next) {
      next();
    }
  }

  /**
   * Fetches handler definitions from server API, binds them to target nodes, and triggers pipeline rerun.
   *
   * @param query API query parameters.
   * @param targetNodes Array of Node instances to bind handlers to.
   * @param next Optional callback.
   * @param overwrite Boolean flag whether to overwrite existing handler bindings (default true).
   * @param targetEvent Optional target event or phase string override.
   * @returns Promise resolving when handlers are bound and pipeline is rerun.
   * @useCase Dynamic handler fetching and inspection tooling.
   */
  async fetchHandlers(query: any, targetNodes: Node[], next?: () => void, overwrite: boolean = true, targetEvent?: string): Promise<void> {
    try {
      const queryParams = new URLSearchParams(query as any).toString();
      const queryURL = queryParams ? `/api/handlers?${queryParams}` : `/api/handlers`;
      const response = await fetch(queryURL, { method: "GET" });
      const handlers = await response.json();

      // Add handlers and inspectedNodeData to the templateData component list so they persist across reinstantiations
      if (Supervisor.instance && Supervisor.instance.templateData) {
        const rootData = Supervisor.instance.templateData.root.data;
        rootData.component = rootData.component || [];
        handlers.forEach((h: any) => {
          if (!rootData.component!.some((c: any) => c.reference === h.name)) {
            rootData.component!.push({ reference: h.name, value: h.body });
          }
        });
        if (!rootData.component!.some((c: any) => c.reference === "inspectedNodeData")) {
          rootData.component!.push({ reference: "inspectedNodeData", value: "" });
        }
      }

      // Also add handlers to the root node component list for immediate child resolution on the current root node instance
      const root = Supervisor.getRootNode();
      if (root) {
        handlers.forEach((h: any) => {
          if (!root.sourceComponents.has(h.name)) {
            root.sourceComponents.set(h.name, new Component({ reference: h.name, value: h.body }, root, 0));
          }
        });
        if (!root.sourceComponents.has("inspectedNodeData")) {
          root.sourceComponents.set("inspectedNodeData", new Component({ reference: "inspectedNodeData", value: "" }, root, 0));
        }
      }

      targetNodes.forEach(node => {
        const currentHandlersMap = node.handlers ? { ...node.handlers } : (node.data?.handlers ? { ...node.data.handlers } : {});
        const handlersMap: any = { ...currentHandlersMap };
        const knownPhases = ["beforeAssembly", "afterAssembly", "beforeRender", "afterRender", "beforeInstantiate", "afterInstantiate", "beforePreprocessing", "afterPreprocessing", "beforeValidation", "afterValidation", "beforePostprocessing", "afterPostprocessing"];

        handlers.forEach((h: any) => {
          if (targetEvent) {
            const isPhase = knownPhases.includes(targetEvent);
            if (overwrite || handlersMap[targetEvent] === undefined) {
              console.log(`Inserting handler ${h.name} for explicit targetEvent ${targetEvent} into node`, node.data);
              handlersMap[targetEvent] = {
                name: h.name,
                body: h.body,
                event: !isPhase ? targetEvent : undefined,
                phase: isPhase ? targetEvent : undefined
              };
              if (!this.handlers[h.name]) this.handlers[h.name] = this.compileHandler(h.name, h.body)!;
            }
          } else {
            // Put raw handler body in data.handlers under its name
            if (overwrite || handlersMap[h.name] === undefined) {
              console.log(`Inserting handler ${h.name} into node`, node.data);
              handlersMap[h.name] = { name: h.name, body: h.body };
              if (!this.handlers[h.name]) this.handlers[h.name] = this.compileHandler(h.name, h.body)!;
            }

            // If the node has a component reference matching the handler's name, map it to the target event
            const eventBinding = Array.from(node.targetComponents.values()).find((c: any) => c.reference === h.name && c.target?.startsWith("handlers."));
            if (eventBinding && eventBinding.target) {
              eventBinding.value = { name: h.name, body: h.body };
              const subTarget = eventBinding.target.substring(9);
              const eventName = subTarget.startsWith("event.") ? subTarget.substring(6) : (subTarget.startsWith("phase.") ? subTarget.substring(6) : subTarget);
              const isSubPhase = knownPhases.includes(eventName);
              if (overwrite || handlersMap[eventName] === undefined) {
                console.log(`Inserting handler ${h.name} for event/phase ${eventName} into node`, node.data);
                handlersMap[eventName] = {
                  name: h.name,
                  body: h.body,
                  event: !isSubPhase ? eventName : undefined,
                  phase: isSubPhase ? eventName : undefined
                };
                if (!this.handlers[h.name]) this.handlers[h.name] = this.compileHandler(h.name, h.body)!;
              }
            }
          }
        });
        node.receiveNextState({ handlers: handlersMap });
      });
    } catch (err) {
      console.error("Failed to fetch handlers:", err);
    }

    if (next) {
      next();
    } else {
      await Supervisor.rerun();
    }
  }

  /**
   * Dispatches a synthetic event on a target DOM element / Virtual DOM Node.
   * Operates directly on the DOM element (`node.element`) to test CSS behavior and JS handlers in MCP context.
   *
   * @param selector Query selector string or NodeQuery object.
   * @param eventType Standard or custom event type name (e.g. 'click', 'input', 'submit').
   * @param eventData Optional event detail payload.
   * @returns Promise resolving to `true` if target element/node was located and dispatched, `false` otherwise.
   */
  async dispatchSyntheticEvent(
    selector: string | NodeQuery,
    eventType: string,
    eventData?: any
  ): Promise<boolean> {
    const root = Supervisor.getRootNode();
    if (!root) return false;

    let targetNode: Node | null = null;
    const allNodes: Node[] = [root, ...Supervisor.getContentNodes()];

    if (typeof selector === 'string') {
      for (const node of allNodes) {
        if (node.element && typeof (node.element as any).matches === 'function' && (node.element as any).matches(selector)) {
          targetNode = node;
          break;
        }
        if (node.css?.id === selector || node.props?.id === selector || node.css?.classes?.includes(selector)) {
          targetNode = node;
          break;
        }
      }
      if (!targetNode && typeof document !== 'undefined') {
        const domEl = document.querySelector(selector);
        if (domEl) {
          targetNode = allNodes.find(n => n.element === domEl) || null;
        }
      }
    } else {
      const { NodeQueryUtils } = await import("./utils/NodeQueryUtils.js");
      targetNode = allNodes.find(n => NodeQueryUtils.isMatch(n, selector)) || null;
    }

    if (!targetNode) return false;

    const preState = targetNode.exportToJson();

    const syntheticEvent = (typeof Event !== 'undefined' && targetNode.element)
      ? new CustomEvent(eventType, { bubbles: true, cancelable: true, detail: eventData })
      : { type: eventType, detail: eventData, target: targetNode.element || targetNode };

    for (const listener of this.beforeEventListeners) {
      try {
        listener(syntheticEvent as any, targetNode, preState, preState);
      } catch (err) {
        console.error("[ClientAPI] Error in beforeEventListener:", err);
      }
    }

    if (targetNode.element && typeof (targetNode.element as any).dispatchEvent === 'function') {
      (targetNode.element as any).dispatchEvent(syntheticEvent as Event);
    } else {
      targetNode.executeHandlers(eventType, { event: syntheticEvent, clientAPI: this });
    }

    const postState = targetNode.exportToJson();

    for (const listener of this.afterEventListeners) {
      try {
        listener(syntheticEvent as any, targetNode, preState, postState);
      } catch (err) {
        console.error("[ClientAPI] Error in afterEventListener:", err);
      }
    }

    return true;
  }
}


/** Global ClientAPI singleton instance. Exposed in client handlers as `context.clientAPI`. */
export const clientAPI = new ClientAPI();

