(event, context) => {
  let container = context.node;
  while (container && !(container.data.css?.classes || []).includes("preempt-editor-panel")) {
      container = container.parent;
  }
  if (!container) return alert("Editor panel not found");
  
  const modalNode = container.findNode({ classes: ["publish-modal-overlay"] });
  if (modalNode) {
    modalNode.data.css = modalNode.data.css || {};
    modalNode.data.css.style = modalNode.data.css.style || {};
    modalNode.data.css.style.display = "flex";
    modalNode.hasChangedSinceRender = true;
    modalNode.render();
  } else {
    alert("Publish modal component not found.");
  }
}
