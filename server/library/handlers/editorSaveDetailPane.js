async (event, context) => {
  event.stopPropagation();
  const metadata = window.Preempt.metadata || {};
  const id = metadata.editor_detail_pane_id;
  const targetType = metadata.editor_detail_pane_type;
  const targetRef = metadata.editor_detail_pane_ref;
  const content = metadata.editor_detail_pane_content;

  if (!id) {
    alert("Cannot save: No database ID found. It might be inline.");
    return;
  }

  let payload = content;
  if (targetType === "component") {
    try {
      payload = JSON.parse(content);
    } catch (err) {
      alert("Invalid JSON for component.");
      return;
    }
  }

  try {
    let url = targetType === "handler" ? `/api/handlers/${id}` : `/api/components/${id}`;
    const body = targetType === "handler" ? { name: targetRef, body: content } : { name: targetRef, payload: payload };
    
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error("Failed to save");

    context.clientAPI.addContentNodes([], "editor-modal");
    
    alert(`Saved successfully. You may need to hit /sync to update the server cache.`);
  } catch(err) {
    console.error(err);
    alert("Error saving: " + err.message);
  }
}
