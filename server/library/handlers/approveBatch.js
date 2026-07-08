async (event, context) => {
  console.log("Executing handler: approveBatch");
  event.preventDefault();
  const batchId = event.target.getAttribute('data-id');
  if (!batchId) return;

  try {
    const res = await fetch(`/api/mcp/admin/change-batches/${batchId}/approve`, {
      method: 'POST'
    });

    if (res.ok) {
      alert("Batch approved successfully!");
      // Re-trigger the fetch to refresh the list safely
      let container = context.node;
      while (container && !(container.css?.classes || []).includes("admin-approval-container")) {
        container = container.parent;
      }
      if (container) {
        // Instead of re-invoking the handler via string eval, we can dispatch a custom event
        // or just rely on a window reload for simplicity if state isn't complex
        window.location.reload();
      }
    } else {
      const err = await res.json();
      alert("Failed to approve batch: " + (err.error || res.statusText));
    }
  } catch (err) {
    console.error("Error approving batch:", err);
    alert("Error approving batch.");
  }
}
