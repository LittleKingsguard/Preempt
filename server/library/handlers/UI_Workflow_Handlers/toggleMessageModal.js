(event, context) => {
  const modalContent = context.node.parent.findNode({ props: { id: "modal-message-container" } });
  if (!modalContent) return;
  
  const currentDisplay = modalContent.data.css?.style?.display || "block";
  
  modalContent.data.css = modalContent.data.css || {};
  modalContent.data.css.style = modalContent.data.css.style || {};
  
  if (currentDisplay === "none") {
    modalContent.data.css.style.display = "block";
  } else {
    modalContent.data.css.style.display = "none";
  }
  
  modalContent.hasChangedSinceRender = true;
  modalContent.render();
}
