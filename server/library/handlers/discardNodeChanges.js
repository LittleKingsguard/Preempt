(event, context) => {
  console.log("Executing handler: discardNodeChanges", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const display = document.getElementById("editor-inspector-display");
  if (!display) return;
  if (window.Preempt && window.Preempt.inspectedNode) {
    display.innerText = JSON.stringify(window.Preempt.inspectedNode.data, null, 2);
    alert("Discarded edits.");
  }
}
