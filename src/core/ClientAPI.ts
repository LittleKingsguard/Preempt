import { Supervisor } from "./Supervisor.js";
import { Node } from "./Node.js";
import type { NodeData, NodeQuery, ContentPayload } from "../types/NodeSchema.js";

export class ClientAPI {
  async fetchContent(
    options: { url: string, batchLabel: string, query: NodeQuery, defaultTemplate?: NodeData, placements: string[] },
    next?: () => void
  ): Promise<void> {
    const queryParams = new URLSearchParams(options.query as any).toString();
    const queryURL = queryParams ? `${options.url}?${queryParams}` : options.url;
    const response = await fetch(queryURL, { method: "GET" });
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
      if (!node.data.placement) {
        node.data.placement = { targetPlacement: [] };
      }
      if (!node.data.placement.targetPlacement) {
        node.data.placement.targetPlacement = [];
      }
      node.data.placement.targetPlacement.push(...options.placements);
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
      const newPayload: ContentPayload = {
        metadata: { ...combinedMetadata, batchLabel: options.batchLabel },
        content: nodes.map(n => n.exportToJson()) as NodeData[],
        component: allComponents
      };
      const existingIndex = Supervisor.instance.contentData.findIndex(p => p.metadata?.batchLabel === options.batchLabel);
      if (existingIndex > -1) {
        Supervisor.instance.contentData[existingIndex] = newPayload;
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
              node.data.handlers![targetEvent] = h.body;
              node.hasChangedSinceRender = true;
            }
          } else {
            // Put raw handler body in data.handlers under its name
            if (overwrite || node.data.handlers![h.name] === undefined) {
              console.log(`Inserting handler ${h.name} into node`, node.data);
              node.data.handlers![h.name] = h.body;
              node.hasChangedSinceRender = true;
            }

            // If the node has a component reference matching the handler's name, map it to the target event
            const eventBinding = node.component?.find((c: any) => c.reference === h.name && c.target?.startsWith("handlers."));
            if (eventBinding) {
              const eventName = eventBinding.target.substring(9);
              if (overwrite || node.data.handlers![eventName] === undefined) {
                console.log(`Inserting handler ${h.name} for event ${eventName} into node`, node.data);
                node.data.handlers![eventName] = h.body;
                node.hasChangedSinceRender = true;
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
