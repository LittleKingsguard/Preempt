(event, context) => {
  console.log("Executing handler: saveAsNewContent", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  let container = context.node;
  while (container && !(container.css?.classes || []).includes("preempt-editor-panel")) {
      container = container.parent;
  }
  if (!container) return alert("Editor panel not found");
  
  const modalNode = container.findNode({ classes: ["publish-modal-overlay"] });
  if (modalNode) {
    modalNode.css = modalNode.css || {};
    modalNode.css.style = modalNode.css.style || {};
    modalNode.css.style.display = "flex";
    modalNode.hasChangedSinceRender = true;
    modalNode.render();
  } else {
    alert("Publish modal component not found.");
  }
}
