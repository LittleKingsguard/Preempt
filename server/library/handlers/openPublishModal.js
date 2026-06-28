(event, context) => {
  let container = context.node;
  while (container && !(container.data.css?.classes || []).includes("article-creator-panel") && !(container.data.css?.classes || []).includes("preempt-editor-panel")) {
      container = container.parent;
  }
  if (!container) return;
  const modalNode = container.findNode({ classes: ["publish-modal-overlay"] });
  if (modalNode) {
    modalNode.data.css = modalNode.data.css || {};
    modalNode.data.css.style = modalNode.data.css.style || {};
    modalNode.data.css.style.display = "flex";
    modalNode.hasChangedSinceRender = true;
    modalNode.render();
  }
}
