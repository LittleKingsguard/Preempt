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
    // Ensure CSS style object exists before mutating
    dropdownNode.css = dropdownNode.css || {};
    dropdownNode.css.style = dropdownNode.css.style || {};
    
    // Toggle the JSON data state directly to survive pipeline re-renders
    const isCurrentlyBlock = dropdownNode.css.style.display === "block";
    dropdownNode.css.style.display = isCurrentlyBlock ? "none" : "block";
    
    // Disable render optimization and flush state
    dropdownNode.hasChangedSinceRender = true;
    dropdownNode.render();
  }
}
