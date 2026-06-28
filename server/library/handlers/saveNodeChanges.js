async (event, context) => {
  const display = document.getElementById("editor-inspector-display");
  if (!display) return alert("No inspector found");
  
  try {
    const updatedData = JSON.parse(display.innerText);
    if (window.Preempt && window.Preempt.inspectedNode) {
        window.Preempt.inspectedNode.data = updatedData;
        window.Preempt.inspectedNode.hasChangedSinceRender = true;
        await window.Preempt.Supervisor.process(
          window.Preempt.templateData, 
          window.Preempt.contentData, 
          window.Preempt.pipelineConfig
        );
        alert("Changes applied to node.");
    } else {
        alert("No active node selected to modify.");
    }
  } catch (err) {
    alert("Invalid JSON data in inspector.");
  }
}
