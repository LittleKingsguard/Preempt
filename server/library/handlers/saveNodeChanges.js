async (event, context) => {
  console.log("Executing handler: saveNodeChanges", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const display = document.getElementById("editor-inspector-display");
  if (!display) return alert("No inspector found");
  
  try {
    const updatedData = JSON.parse(display.innerText);
    if (window.Preempt && window.Preempt.inspectedNode) {
        window.Preempt.inspectedNode.receiveNextState(updatedData);
        await window.Preempt.Supervisor.process(
          window.Preempt.pipelineConfig || window.Preempt.config,
          window.Preempt.templateData, 
          window.Preempt.contentData
        );
        alert("Changes applied to node.");
    } else {
        alert("No active node selected to modify.");
    }
  } catch (err) {
    alert("Invalid JSON data in inspector.");
  }
}
