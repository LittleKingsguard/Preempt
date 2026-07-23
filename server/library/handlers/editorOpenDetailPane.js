async (event, context) => {
  event.stopPropagation();
  const targetRef = event.target.getAttribute("data-target-ref");
  const targetType = event.target.getAttribute("data-target-type");
  if (!targetRef) return;

  if (!window.Preempt) window.Preempt = {};
  if (!window.Preempt.metadata) window.Preempt.metadata = {};
  
  window.Preempt.metadata.editor_detail_pane_node = window.Preempt.inspectedNode || context.node;
  window.Preempt.metadata.editor_detail_pane_type = targetType;
  window.Preempt.metadata.editor_detail_pane_ref = targetRef;

  try {
    let url = `/api/components?name=${targetRef}`;
    if (targetType === "handler") {
      url = `/api/handlers?name=${targetRef}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch details");
    const data = await res.json();
    
    let content = "";
    let id = null;

    if (targetType === "handler") {
      const item = data.find(h => h.name === targetRef);
      if (item) {
        content = item.body;
        id = item.id;
      }
    } else {
      const item = data.find(c => c.name === targetRef);
      if (item) {
        content = typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload, null, 2);
        id = item.id;
      }
    }

    window.Preempt.metadata.editor_detail_pane_id = id;
    window.Preempt.metadata.editor_detail_pane_content = content;

    const detailNode = {
      type: "div",
      placement: [{ targetPlacement: ["modal"] }],
      component: [{ reference: "editorDetailPane", target: "type" }]
    };
    
    context.clientAPI.addContentNodes([detailNode], "editor-modal");
  } catch (err) {
    console.error("Error opening detail pane", err);
    alert("Error fetching details: " + err.message);
  }
}
