(context) => {
  const node = context.node;
  const supervisor = context.supervisor;
  
  if (supervisor && supervisor.userData) {
    // User is signed in
    if (node.children[0]) {
      node.children[0].data.content = "Profile ▼";
    }
  } else {
    // User is not signed in
    // Convert the button to a "Sign In" link
    if (node.children[0]) {
      node.children[0].data.type = "a";
      node.children[0].data.content = "Sign In";
      node.children[0].data.props = { href: "/login" };
      // Remove the dropdown toggle handler
      if (node.children[0].data.component) {
        node.children[0].data.component = node.children[0].data.component.filter(c => c.reference !== "ToggleUserDropdown");
      }
    }
    // Remove the dropdown menu entirely
    if (node.children.length > 1) {
      node.children.pop(); // Remove the parsed child node
    }
    if (Array.isArray(node.data.content) && node.data.content.length > 1) {
      node.data.content.pop(); // Remove the dropdown from the JSON payload
    }
  }
}
