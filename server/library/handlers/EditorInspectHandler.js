(event, context) => {
  event.stopPropagation();
  const node = context.node;
  if (!window.Preempt) window.Preempt = {};
  window.Preempt.inspectedNode = node;
  
  const displayNode = context.rootNode.findNode(n => n.css && n.css.id === "editor-inspector-display");
  if (displayNode) {
    context.clientAPI.modifyNode(
      { content: JSON.stringify(node.data, null, 2) },
      displayNode,
      undefined,
      false
    );
  }

  let isComponent = false;
  let curr = node;
  while (curr) {
    if (curr.isComponentInjected || (curr.component && curr.component.length > 0)) {
      isComponent = true;
      break;
    }
    curr = curr.parent;
  }

  const editorPanelNode = context.rootNode.findNode(n => n.css && n.css.classes && n.css.classes.includes("preempt-editor-panel"));
  if (editorPanelNode) {
    const newClasses = [...(editorPanelNode.css?.classes || [])];
    if (isComponent) {
      if (!newClasses.includes("editor-mode-component")) newClasses.push("editor-mode-component");
      const filtered = newClasses.filter(c => c !== "editor-mode-content" && c !== "editor-mode-template");
      context.clientAPI.modifyNode({ css: { ...editorPanelNode.css, classes: filtered } }, editorPanelNode, undefined, false);
    } else {
      const filtered = newClasses.filter(c => c !== "editor-mode-component");
      const baseMode = (editorPanelNode.props && editorPanelNode.props["data-base-mode"]) ? editorPanelNode.props["data-base-mode"] : "editor-mode-content";
      if (!filtered.includes(baseMode)) filtered.push(baseMode);
      context.clientAPI.modifyNode({ css: { ...editorPanelNode.css, classes: filtered } }, editorPanelNode, undefined, false);
    }
  }
}
