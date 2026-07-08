async (event, context) => {
  console.log("Executing handler: rejectBatch", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.preventDefault();
  const batchId = event.target.getAttribute('data-id');
  if (!batchId) return;

  if (!confirm("Are you sure you want to reject and delete this change batch?")) return;

  try {
    const res = await fetch(`/api/mcp/admin/change-batches/${batchId}/reject`, {
      method: 'POST'
    });

    if (res.ok) {
      alert("Batch rejected and deleted.");
      // For simplicity, reload to show updated state
      window.location.reload();
    } else {
      const err = await res.json();
      alert("Failed to reject batch: " + (err.error || res.statusText));
    }
  } catch (err) {
    console.error("Error rejecting batch:", err);
    alert("Error rejecting batch.");
  }
}
