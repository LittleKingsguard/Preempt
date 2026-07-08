async (event, context) => {
  console.log("Executing handler: commitComponentChanges", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const display = document.getElementById("editor-inspector-display");
  if (!display) return alert("No inspector found");
  
  try {
    const updatedData = JSON.parse(display.innerText);
    
    const componentName = prompt("Enter the exact name of the component you are modifying:");
    if (!componentName) return;
    
    // Fetch all components to resolve the ID
    const getRes = await fetch("/api/components");
    const components = await getRes.json();
    const targetComp = components.find(c => c.name === componentName);
    
    if (!targetComp) {
      return alert(`Component '${componentName}' not found.`);
    }
    
    const putRes = await fetch(`/api/components/${targetComp.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: componentName, payload: updatedData })
    });
    
    if (putRes.ok) {
      alert(`Component '${componentName}' updated successfully!`);
      const inspectedNode = window.Preempt?.inspectedNode;
      if (inspectedNode) {
        inspectedNode.data = updatedData;
        if (context.supervisor) context.supervisor.process();
      }
    } else {
      const err = await putRes.json();
      alert("Failed to update component: " + (err.error || "Unknown error"));
    }
  } catch (err) {
    alert("Invalid JSON data in inspector.");
    console.error(err);
  }
}
