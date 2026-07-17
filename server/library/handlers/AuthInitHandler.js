(event, context) => {
  console.log("Executing handler: AuthInitHandler", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const node = context.node;
  const supervisor = context.supervisor;
  
  if (supervisor && supervisor.userData) {
    // User is signed in
    if (node.children[0]) {
      node.children[0].content = "Profile ▼";
    }
  } else {
    // User is not signed in
    // Convert the button to a "Sign In" link
    if (node.children[0]) {
      node.children[0].type = "a";
      node.children[0].content = "Sign In";
      node.children[0].props = { href: "/api/oauth/login" };
      // Remove the dropdown toggle handler
      if (node.children[0].sourceComponents) {
        for (const [key, comp] of Array.from(node.children[0].targetComponents.entries())) {
          if (comp.reference === "ToggleUserDropdown") {
            node.children[0].targetComponents.delete(key);
          }
        }
      } else if (node.children[0].component) {
        node.children[0].component = node.children[0].component.filter(c => c.reference !== "ToggleUserDropdown");
      }
    }
    // Remove the dropdown menu entirely
    if (node.children.length > 1) {
      node.children.pop(); // Remove the parsed child node
    }
    if (Array.isArray(node.content) && node.content.length > 1) {
      node.content.pop(); // Remove the dropdown from the JSON payload
    }
  }
}
