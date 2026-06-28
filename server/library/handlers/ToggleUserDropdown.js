(event, context) => {
  let container = context.node;
  // Traverse up to the component root container safely
  while (container && !(container.data.css?.classes || []).includes("user-auth-dropdown")) {
      container = container.parent;
  }
  
  if (!container) return;

  // Use findNode to locate the target element
  const dropdownNode = container.findNode({ classes: ["dropdown-menu"] });
  
  if (dropdownNode) {
    // Ensure CSS style object exists before mutating
    dropdownNode.data.css = dropdownNode.data.css || {};
    dropdownNode.data.css.style = dropdownNode.data.css.style || {};
    
    // Toggle the JSON data state directly to survive pipeline re-renders
    const isCurrentlyBlock = dropdownNode.data.css.style.display === "block";
    dropdownNode.data.css.style.display = isCurrentlyBlock ? "none" : "block";
    
    // Disable render optimization and flush state
    dropdownNode.hasChangedSinceRender = true;
    dropdownNode.render();
  }
}
