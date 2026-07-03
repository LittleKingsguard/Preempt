(event, context) => {
  let container = context.node;
  while (container && !(container.css?.classes || []).includes("article-creator-panel") && !(container.css?.classes || []).includes("preempt-editor-panel")) {
      container = container.parent;
  }
  if (!container) return;
  const modalNode = container.findNode({ classes: ["publish-modal-overlay"] });
  if (modalNode) {
    modalNode.css = modalNode.css || {};
    modalNode.css.style = modalNode.css.style || {};
    modalNode.css.style.display = "flex";
    modalNode.hasChangedSinceRender = true;
    modalNode.render();
  }
}
