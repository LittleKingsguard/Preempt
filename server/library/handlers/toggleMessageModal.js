(event, context) => {
  console.log("Executing handler: toggleMessageModal", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const modalContent = context.node.parent.findNode({ props: { id: "modal-message-container" } });
  if (!modalContent) return;
  
  const currentDisplay = modalContent.css?.style?.display || "block";
  const newDisplay = currentDisplay === "none" ? "block" : "none";
  const currentCss = modalContent.css || {};
  const currentStyle = currentCss.style || {};

  modalContent.receiveNextState({
    css: {
      ...currentCss,
      style: { ...currentStyle, display: newDisplay }
    }
  });
}
