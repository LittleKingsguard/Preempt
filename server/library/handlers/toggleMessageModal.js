(event, context) => {
  const modalContent = context.node.parent.findNode({ props: { id: "modal-message-container" } });
  if (!modalContent) return;
  
  const currentDisplay = modalContent.css?.style?.display || "block";
  
  modalContent.css = modalContent.css || {};
  modalContent.css.style = modalContent.css.style || {};
  
  if (currentDisplay === "none") {
    modalContent.css.style.display = "block";
  } else {
    modalContent.css.style.display = "none";
  }
  
  modalContent.hasChangedSinceRender = true;
  modalContent.render();
}
