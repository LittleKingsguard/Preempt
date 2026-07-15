import { Supervisor } from "./Supervisor.js";
import { Node } from "./Node.js";
import type { NodeData, NodeQuery, ContentPayload } from "../types/NodeSchema.js";

export class ClientAPI {
  public handlers: { [key: string]: Function } = {};

  constructor() {}

  public getHandler(key: string, contextNode?: Node): Function | undefined {
    let current: Node | null | undefined = contextNode;
    while (current) {
      if (current.compiledHandlers && current.compiledHandlers[key]) {
        return current.compiledHandlers[key];
      }
      
      const componentBinding = current.component?.find(c => c.reference === key);
      if (componentBinding && typeof componentBinding.value === 'object' && componentBinding.value !== null && 'body' in componentBinding.value) {
        const compiled = this.compileHandler(key, componentBinding.value.body as string);
        if (compiled) {
          if (!current.compiledHandlers) current.compiledHandlers = {};
          current.compiledHandlers[key] = compiled;
          return compiled;
        }
      }
      
      current = current.parent;
    }
    
    if (this.handlers[key]) {
      return this.handlers[key];
    }
    
    console.error(`Handler ${key} not found in tree.`);
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
          if (obj.payload || (obj.content && !obj.type)) {
            const { payload, content, ...rest } = obj;
            Object.assign(combinedMetadata, rest);
            if (obj.payload) return obj.payload;
            return obj.content;
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

      nodes = payloads.map((item: any) => new Node(item));
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
        return new Node(nodeObj);
      });
    }

    nodes.forEach((node: Node) => {
      if (!node.data.props) node.data.props = {};
      node.data.props.batchLabel = options.batchLabel;
      if (!node.props) node.props = {};
      node.props.batchLabel = options.batchLabel;
      
      if (!node.data.placement) {
        node.data.placement = { targetPlacement: [] };
      }
      if (!node.data.placement.targetPlacement) {
        node.data.placement.targetPlacement = [];
      }
      node.data.placement.targetPlacement.push(...options.placements);
      
      if (!node.placement) node.placement = { targetPlacement: [] };
      if (!node.placement.targetPlacement) node.placement.targetPlacement = [];
      node.placement.targetPlacement.push(...options.placements);
    });

    if (Supervisor.instance) {
      if (!Supervisor.instance.contentData) {
        Supervisor.instance.contentData = [];
      }
      const allComponents: any[] = [];
      nodes.forEach((n: Node) => {
        if (n.component) {
          allComponents.push(...n.component);
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
      const existingIndex = Supervisor.instance.contentData.findIndex(p => p.metadata?.batchLabel === options.batchLabel);
      if (existingIndex > -1) {
        this.replacePayload(Supervisor.instance, existingIndex, newPayload);
      } else {
        Supervisor.instance.contentData.push(newPayload);
      }
    }

    if (next) {
      next();
    } else {
      await Supervisor.rerun();
    }
  }

  async modifyNode(
    partialNode: Partial<Node>,
    targetNode: Node,
    next?: () => void,
    persistent?: boolean
  ): Promise<void> {
    const isPersistent = persistent !== undefined ? persistent : (Supervisor.currentStage === 'closed');

    if (isPersistent) {
      const dataToMerge: any = {};
      const dataKeys = ['type', 'content', 'css', 'props', 'handlers', 'component', 'placement', 'versions'];
      for (const key of dataKeys) {
        if (key in partialNode) {
          dataToMerge[key] = (partialNode as any)[key];
        }
      }
      targetNode.modify(dataToMerge);
      targetNode.hasChangedSinceRender = true;

      if (next) {
        next();
      } else {
        await Supervisor.rerun();
      }
    } else {
      const nodeKeys = ['type', 'content', 'css', 'props', 'handlers', 'component', 'placement', 'versions'];
      for (const key of nodeKeys) {
        if (key in partialNode) {
          (targetNode as any)[key] = (partialNode as any)[key];
        }
      }
      targetNode.hasChangedSinceRender = true;
      targetNode.validate();
      targetNode.render();
      if (next) next();
    }
  }

  async addContentNodes(nodes: any | any[], batchId: string, next?: () => void): Promise<void> {
    const nodeArray = Array.isArray(nodes) ? nodes : [nodes];
    if (Supervisor.instance) {
      if (!Supervisor.instance.contentData) Supervisor.instance.contentData = [];
      const newPayload: ContentPayload = {
        metadata: { batchLabel: batchId },
        content: nodeArray,
        component: []
      };
      const existingIndex = Supervisor.instance.contentData.findIndex(p => p.metadata?.batchLabel === batchId);
      if (existingIndex > -1) {
        this.replacePayload(Supervisor.instance, existingIndex, newPayload);
      } else {
        Supervisor.instance.contentData.push(newPayload);
      }
    }

    if (next) {
      next();
    } else {
      await Supervisor.rerun();
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
        const td = Supervisor.instance.templateData;
        td.component = td.component || [];
        handlers.forEach((h: any) => {
          if (!td.component!.some((c: any) => c.reference === h.name)) {
            td.component!.push({ reference: h.name, value: h.body });
          }
        });
        if (!td.component!.some((c: any) => c.reference === "inspectedNodeData")) {
          td.component!.push({ reference: "inspectedNodeData", value: "" });
        }
      }

      // Also add handlers to the root node component list for immediate child resolution on the current root node instance
      const root = Supervisor.getRootNode();
      if (root) {
        root.component = root.component || [];
        handlers.forEach((h: any) => {
          if (!root.component!.some((c: any) => c.reference === h.name)) {
            root.component!.push({ reference: h.name, value: h.body });
          }
        });
        if (!root.component!.some((c: any) => c.reference === "inspectedNodeData")) {
          root.component!.push({ reference: "inspectedNodeData", value: "" });
        }
      }

      targetNodes.forEach(node => {
        if (!node.data) {
          node.data = { type: node.type || "div" };
        }
        if (!node.data.handlers) {
          node.data.handlers = {};
        }
        handlers.forEach((h: any) => {
          if (targetEvent) {
            if (overwrite || node.data.handlers![targetEvent] === undefined) {
              console.log(`Inserting handler ${h.name} for explicit event ${targetEvent} into node`, node.data);
              node.data.handlers![targetEvent] = { name: h.name, body: h.body };
              node.hasChangedSinceRender = true;
              if (!this.handlers[h.name]) this.handlers[h.name] = this.compileHandler(h.name, h.body)!;
            }
          } else {
            // Put raw handler body in data.handlers under its name
            if (overwrite || node.data.handlers![h.name] === undefined) {
              console.log(`Inserting handler ${h.name} into node`, node.data);
              node.data.handlers![h.name] = { name: h.name, body: h.body };
              node.hasChangedSinceRender = true;
              if (!this.handlers[h.name]) this.handlers[h.name] = this.compileHandler(h.name, h.body)!;
            }

            // If the node has a component reference matching the handler's name, map it to the target event
            const eventBinding = node.component?.find((c: any) => c.reference === h.name && c.target?.startsWith("handlers."));
            if (eventBinding) {
              eventBinding.value = { name: h.name, body: h.body };
              const eventName = eventBinding.target.substring(9);
              if (overwrite || node.data.handlers![eventName] === undefined) {
                console.log(`Inserting handler ${h.name} for event ${eventName} into node`, node.data);
                node.data.handlers![eventName] = { name: h.name, body: h.body };
                node.hasChangedSinceRender = true;
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

  private replacePayload(instance: any, existingIndex: number, newPayload: ContentPayload) {
    const oldPayload = instance.contentData[existingIndex];
    const oldLen = (oldPayload as any).type ? 1 : (Array.isArray(oldPayload.content) ? oldPayload.content.length : 0);
    const newLen = (newPayload as any).type ? 1 : (Array.isArray(newPayload.content) ? newPayload.content.length : 0);
    
    let startIndex = 0;
    for (let i = 0; i < existingIndex; i++) {
      const p = instance.contentData[i];
      startIndex += (p as any).type ? 1 : (Array.isArray(p.content) ? p.content.length : 0);
    }

    if (instance.contentNodes) {
      for (let i = startIndex; i < startIndex + oldLen; i++) {
        const oldNode = instance.contentNodes[i];
        if (oldNode) {
          if (oldNode.element) oldNode.element.remove();
          if (oldNode.parent) {
            const idx = oldNode.parent.children.indexOf(oldNode);
            if (idx > -1) oldNode.parent.children.splice(idx, 1);
          }
        }
      }

      const newNodes = new Array(newLen).fill(null);
      instance.contentNodes.splice(startIndex, oldLen, ...newNodes);
    }

    instance.contentData[existingIndex] = newPayload;
  }
}

export const clientAPI = new ClientAPI();
