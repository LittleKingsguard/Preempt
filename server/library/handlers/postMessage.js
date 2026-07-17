async (event, context) => {
  console.log("Executing handler: postMessage", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const listId = context.node.parent.parent.props.listId;
  const inputEl = document.getElementById("new-message-input");
  const body = inputEl ? inputEl.value : "";
  
  if (!body.trim()) return;

  try {
    const res = await fetch(`/api/messages/${listId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body })
    });
    
    if (res.ok) {
      if (inputEl) inputEl.value = "";
      
      // We can trigger fetchMessageThread to reload the messages
      const threadNode = context.node.parent.parent;
      const allThreadComps = threadNode.sourceComponents ? [...Array.from(threadNode.sourceComponents.values()), ...Array.from(threadNode.targetComponents.values())] : (threadNode.component || []);
      const fetchHandler = allThreadComps.find(c => c.reference === "fetchMessageThread");
      if (fetchHandler) {
         window.location.reload(); 
      } else {
         window.location.reload();
      }
    }
  } catch (err) {
    console.error(err);
  }
}
