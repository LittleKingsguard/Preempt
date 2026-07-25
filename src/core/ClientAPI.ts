import { Supervisor } from "./Supervisor.js";
import { Node } from "./Node.js";
import { Handler } from "./Handler.js";
import type { NodeData, NodeQuery, ContentPayload } from "../types/NodeSchema.js";
import { Component } from "./Component.js";

export class ClientAPI {
  public handlers: { [key: string]: Function } = {};

  constructor() {}

  // resolveComponentBinding was moved to Component.ts

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
        if (!node.data) {
          node.data = { type: node.type || "div" };
        }
        if (!node.data.handlers) {
          (node.data as any).handlers = {};
        }
        handlers.forEach((h: any) => {
          const handlersMap = node.data.handlers as any;
          if (targetEvent) {
            if (overwrite || handlersMap[targetEvent] === undefined) {
              console.log(`Inserting handler ${h.name} for explicit event ${targetEvent} into node`, node.data);
              handlersMap[targetEvent] = { name: h.name, body: h.body };
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
              const eventName = eventBinding.target.substring(9);
              if (overwrite || handlersMap[eventName] === undefined) {
                console.log(`Inserting handler ${h.name} for event ${eventName} into node`, node.data);
                handlersMap[eventName] = { name: h.name, body: h.body };
                if (!this.handlers[h.name]) this.handlers[h.name] = this.compileHandler(h.name, h.body)!;
              }
            }
          }
        });
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
}

export const clientAPI = new ClientAPI();
