async (event, context) => {
  console.log("Executing handler: postComment");
  const commentListId = window.Preempt?.contentData?.metadata?.comment_list_id;
  if (!commentListId) return alert("Error: No comment list associated with this content.");

  const inputEl = document.getElementById("new-comment-input");
  const body = inputEl ? inputEl.value : "";
  
  if (!body.trim()) return alert("Comment cannot be empty.");

  try {
    const res = await fetch(`/api/comments/${commentListId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, target_placement: "end" })
    });
    
    if (res.ok) {
      if (inputEl) inputEl.value = "";
      window.location.reload();
    } else {
      const err = await res.json();
      alert("Failed to post comment: " + (err.error || "Unknown error"));
    }
  } catch (err) {
    console.error(err);
    alert("Error posting comment.");
  }
}
