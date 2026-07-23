import { Supervisor } from "./Supervisor.js";
import { Node } from "./Node.js";
import { Props } from "./Props.js";
import { Handler } from "./Handler.js";
import type { NodeData, NodeQuery, ContentPayload } from "../types/NodeSchema.js";
import { Placement } from "./Placement.js";
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
    const queryParams = new URLSearchParams(options.query as any).toString();
    const queryURL = queryParams ? `${options.url}?${queryParams}` : options.url;
    const response = await fetch(queryURL, { method: "GET", headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    const data = await response.json();
    let nodes: Node[] = [];
    let combinedMetadata: any = {};

    if (options.query.format === "content") {
      const extractPayload = (obj: any) => {
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          if (obj.payload || ((obj.children || obj.content) && !obj.type)) {
            const { payload, children, content, ...rest } = obj;
            Object.assign(combinedMetadata, rest);
            if (obj.payload) return obj.payload;
            return obj.children || obj.content;
          }
        }
        return obj;
      };

      let payloads: any[] = [];
      if (Array.isArray(data)) {
        payloads = data.flatMap((item: any) => {
          const ext = extractPayload(item);
          return Array.isArray(ext) ? ext : [ext];
        });
      } else {
        const ext = extractPayload(data);
        payloads = Array.isArray(ext) ? ext : [ext];
      }

      nodes = payloads.map((item: any) => new Node(item, null, 0));
    } else {
      const templateJSON = JSON.stringify(options.defaultTemplate || {});
      nodes = data.map((item: any) => {
        const nodeObj: any = JSON.parse(templateJSON);
        if (!nodeObj.component) nodeObj.component = [];
        const parseToComponent = (itm: object | string) => {
          if (typeof itm === 'string') {
            nodeObj.component.push({ reference: 'data', value: itm });
          } else {
            Object.keys(itm).forEach((key) => {
              const existingComponent = nodeObj.component.find((c: any) => c.reference === key);
              if (existingComponent) {
                existingComponent.value = (itm as any)[key];
              } else {
                nodeObj.component.push({ reference: key, value: (itm as any)[key] });
              }
            });
          }
        };
        if (typeof item === 'object' && !Array.isArray(item)) {
          parseToComponent(item);
        } else if (Array.isArray(item)) {
          item.forEach((i: any) => parseToComponent(i));
        }
        return new Node(nodeObj, null, 0);
      });
    }

    nodes.forEach((node: Node) => {
      if (!node.props) node.props = new Props({}, node);
      node.props.batchLabel = options.batchLabel;
      
      if (!node.data.placement) {
        (node.data as any).placement = [{ targetPlacement: [] }];
      } else if (node.data.placement.length === 0) {
        node.data.placement.push({ targetPlacement: [] });
      }
      
      const dataPlacement = node.data.placement!;
      const dp0 = dataPlacement[0]!;
      if (!dp0.targetPlacement) {
        dp0.targetPlacement = [];
      }
      dp0.targetPlacement.push(...options.placements);
      
      if (!node.placement) node.placement = [new Placement({ targetPlacement: [] }, node, 0)];
      else if (node.placement.length === 0) node.placement.push(new Placement({ targetPlacement: [] }, node, 0));
      
      const nodePlacement = node.placement!;
      const np0 = nodePlacement[0]!;
      if (!np0.targetPlacement) np0.targetPlacement = [];
      np0.targetPlacement.push(...options.placements);
    });

    if (Supervisor.instance) {
      if (!Supervisor.instance.contentData) {
        Supervisor.instance.contentData = new Set();
      }
      const allComponents: any[] = [];
      nodes.forEach((n: Node) => {
        if (n.sourceComponents.size > 0 || n.targetComponents.size > 0) {
          allComponents.push(...Array.from(n.sourceComponents.values()), ...Array.from(n.targetComponents.values()));
        }
        if (n.data?.component) {
          allComponents.push(...n.data.component);
        }
      });
      if (combinedMetadata.template && combinedMetadata.template.component) {
        allComponents.push(...combinedMetadata.template.component);
      }
      console.log(`[DEBUG] fetchContent gathered allComponents for batch ${options.batchLabel}:`, allComponents.map(c => c.reference));
      const newPayload: ContentPayload = {
        metadata: { ...combinedMetadata, batchLabel: options.batchLabel },
        content: nodes.map(n => n.exportToJson()) as NodeData[],
        component: allComponents
      };
      
      await Supervisor.injectContent(newPayload);
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
