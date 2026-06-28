(event, context) => {
  let container = context.node;
  while (container && !(container.data.css?.classes || []).includes("article-creator-panel")) {
      container = container.parent;
  }
  if (!container) return;
  const modalNode = container.findNode({ classes: ["publish-modal-overlay"] });
  if (modalNode) {
    modalNode.data.css = modalNode.data.css || {};
    modalNode.data.css.style = modalNode.data.css.style || {};
    modalNode.data.css.style.display = "none";
    modalNode.hasChangedSinceRender = true;
    modalNode.render();
  }
}
