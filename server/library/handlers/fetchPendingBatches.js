async (event, context) => {
  console.log("Executing handler: fetchPendingBatches", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  if (typeof window === 'undefined') return;

  try {
    const res = await fetch('/api/mcp/admin/change-batches');
    const listNode = context.node.findNode({ props: { id: "batches-list" } });
    if (!listNode) return;

    if (!res.ok) {
      listNode.content = "Failed to load batches.";
      listNode.hasChangedSinceRender = true;
      listNode.render();
      return;
    }

    const data = await res.json();
    const batches = data.batches || [];

    listNode.children = [];
    listNode.content = [];

    if (batches.length === 0) {
      listNode.addChild({ type: "p", content: "No pending batches." });
    } else {
      batches.forEach(batch => {
        listNode.addChild({
          type: "div",
          css: { style: { padding: "15px", border: "1px solid #ccc", marginBottom: "15px", borderRadius: "5px", background: "#fafafa" } },
          content: [
            { type: "p", content: `Batch ID: ${batch.id} | Author: ${batch.author_id}`, css: { style: { fontWeight: "bold", margin: "0 0 5px 0" } } },
            { type: "p", content: `Description: ${batch.description}`, css: { style: { margin: "0 0 10px 0" } } },
            { type: "p", content: `Created At: ${new Date(batch.created_at).toLocaleString()}`, css: { style: { margin: "0 0 10px 0", fontSize: "0.9em", color: "#666" } } },
            {
              type: "div",
              css: { style: { display: "flex", gap: "10px" } },
              content: [
                { 
                  type: "button", 
                  content: "Approve", 
                  props: { "data-id": batch.id }, 
                  css: { style: { padding: "8px 16px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" } },
                  component: [{"target": "handlers.click", "reference": "approveBatch"}] 
                },
                { 
                  type: "button", 
                  content: "Reject", 
                  props: { "data-id": batch.id }, 
                  css: { style: { padding: "8px 16px", background: "#f44336", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" } },
                  component: [{"target": "handlers.click", "reference": "rejectBatch"}] 
                }
              ]
            }
          ]
        });
      });
    }

    listNode.hasChangedSinceRender = true;
    listNode.render();
  } catch (err) {
    console.error("Error fetching batches:", err);
  }
}
