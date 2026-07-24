(event, context) => {
  console.log("Executing handler: ToggleUserDropdown", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  let container = context.node;
  // Traverse up to the component root container safely
  while (container && !(container.css?.classes || []).includes("user-auth-dropdown")) {
      container = container.parent;
  }
  
  if (!container) return;

  // Use findNode to locate the target element
  const dropdownNode = container.findNode({ classes: ["dropdown-menu"] });
  
  if (dropdownNode) {
    const currentCss = dropdownNode.css || {};
    const currentStyle = currentCss.style || {};
    const isCurrentlyBlock = currentStyle.display === "block";
    const newDisplay = isCurrentlyBlock ? "none" : "block";

    dropdownNode.receiveNextState({
      css: {
        ...currentCss,
        style: { ...currentStyle, display: newDisplay }
      }
    });
  }
}
