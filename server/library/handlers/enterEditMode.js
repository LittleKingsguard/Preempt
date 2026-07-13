async (event, context) => {
  console.log("Executing handler: enterEditMode", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
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
    td.component = td.component || [];
    if (!td.component.some(c => c.reference === "EditorPopulateInspector")) {
      td.component.push({ reference: "EditorPopulateInspector", target: "handlers.dynamic" });
    }
    td.handlers = td.handlers || {};
    td.handlers.afterAssembly = `(event, context) => {
      const root = context.rootNode;
      if (root && root.data) {
        const injectInspect = (node) => {
          if (!node) return;
          let isEditorNode = false;
          let curr = node;
          while (curr) {
            if (curr.data?.props?.batchLabel === "editor-tools" || 
                curr.component?.some(c => c.reference === "PreemptEditor" || c.reference === "editor") ||
                curr.data?.component?.some(c => c.reference === "PreemptEditor" || c.reference === "editor") ||
                curr.css?.classes?.includes("preempt-editor-panel") ||
                curr.css?.id === "editor-inspector-display") {
              isEditorNode = true;
              break;
            }
            curr = curr.parent;
          }
          
          if (!isEditorNode) {
            const hasClickHandler = node.handlers?.click || node.handlers?.onclick;
            const hasComponentClickHandler = node.component?.some(c => c.target === "handlers.click" || c.target === "handlers.onclick");

            if (!hasClickHandler && !hasComponentClickHandler) {
              if (!node.component) node.component = [];
              const binding = { reference: "EditorInspectHandler", target: "handlers.click" };
              if (!node.component.some(c => c.reference === "EditorInspectHandler")) {
                node.component.push(binding);
                node.hasChangedSinceRender = true;
              }
            }
          }
          
          if (node.children) {
            node.children.forEach(injectInspect);
          }
          if (node.component) {
            node.component.forEach(binding => {
              if (binding._instantiatedNodes) {
                binding._instantiatedNodes.forEach(injectInspect);
              }
            });
          }
        };
        injectInspect(root);
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
    
    const collectNodes = (node) => {
      if (!node) return;
      targetNodes.push(node);
      if (node.children) {
        node.children.forEach(collectNodes);
      }
      if (node.component) {
        node.component.forEach(binding => {
          if (binding._instantiatedNodes) {
            binding._instantiatedNodes.forEach(collectNodes);
          }
        });
      }
    };
    
    if (root) {
      collectNodes(root);
    }

    await context.clientAPI.fetchHandlers({ name: "EditorInspectHandler" }, targetNodes, async () => {
      await context.clientAPI.fetchHandlers({ name: "EditorPopulateInspector" }, [root], async () => {
        await window.Preempt.Supervisor.rerun();
      }, false);
    }, false, "click");
  });
}
