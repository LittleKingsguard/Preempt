async (event, context) => {
  event.preventDefault();

  // Find the editorTools content ID by query tag
  const res = await fetch("/api/content?tags=editor-tools");
  const items = await res.json();
  if (!items || items.length === 0) {
    console.error("Editor tools content not found");
    return;
  }
  const contentId = items[0].id;

  // Add the afterAssembly handler to templateData so it automatically runs on every rerun
  if (window.Preempt.Supervisor.instance && window.Preempt.Supervisor.instance.templateData) {
    const td = window.Preempt.Supervisor.instance.templateData;
    td.handlers = td.handlers || {};
    td.handlers.afterAssembly = `(context) => {
      const root = context.rootNode;
      if (root && root.data) {
        const injectInspect = (nodeData) => {
          if (!nodeData) return;
          const node = nodeData.node;
          if (node) {
            if (node.component && node.component.some(c => c.reference === "PreemptEditor" || c.reference === "editor")) return;
            if (node.data?.component?.some(c => c.reference === "PreemptEditor" || c.reference === "editor")) return;

            const hasClickHandler = node.handlers?.click || node.handlers?.onclick;
            const hasComponentClickHandler = node.component?.some(c => c.target === "handlers.click" || c.target === "handlers.onclick");

            if (!hasClickHandler && !hasComponentClickHandler) {
              if (!node.data) node.data = {};
              if (!node.data.component) node.data.component = [];
              const binding = { reference: "EditorInspectHandler", target: "handlers.click" };
              if (!node.data.component.some(c => c.reference === "EditorInspectHandler")) {
                node.data.component.push(binding);
              }
              node.component = node.data.component;
              node.hasChangedSinceRender = true;
            }
          }
          
          if (Array.isArray(nodeData.content)) {
            nodeData.content.forEach(injectInspect);
          } else if (typeof nodeData.content === "object" && nodeData.content !== null) {
            injectInspect(nodeData.content);
          }
        };
        injectInspect(root.data);
        root.applyComponentsTree();
      }
    }`;
  }

  await context.clientAPI.fetchContent({
    url: `/api/content/${contentId}`,
    batchLabel: "editor-tools",
    query: { format: "content" },
    defaultTemplate: {},
    placements: ["article"]
  }, async () => {
    const root = context.rootNode;
    const targetNodes = [];
    
    const collectNodesFromData = (nodeData) => {
      if (!nodeData) return;
      if (nodeData.node) {
        targetNodes.push(nodeData.node);
      }
      if (Array.isArray(nodeData.content)) {
        nodeData.content.forEach(collectNodesFromData);
      } else if (typeof nodeData.content === "object" && nodeData.content !== null) {
        collectNodesFromData(nodeData.content);
      }
    };
    
    if (root && root.data) {
      collectNodesFromData(root.data);
    }

    await context.clientAPI.fetchHandlers({ name: "EditorInspectHandler" }, targetNodes, async () => {
      await window.Preempt.Supervisor.rerun();
    }, false, "click");
  });
}
