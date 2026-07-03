async (event, context) => {
  let payload;
  const display = document.getElementById("editor-inspector-display");
  if (display && window.Preempt && window.Preempt.inspectedNode) {
     try {
       payload = JSON.parse(display.innerText);
     } catch(e) {}
  }
  
  if (!payload) {
    const zone = document.getElementById("article-editor-zone");
    const contentHtml = zone ? zone.innerHTML : "";
    payload = {
      type: "div",
      props: { innerHTML: contentHtml }
    };
  }
  
  const titleInput = document.getElementById("publish-modal-title");
  const subtitleInput = document.getElementById("publish-modal-subtitle");
  const headersInput = document.getElementById("publish-modal-headers");
  const tagsInput = document.getElementById("publish-modal-tags");
  const visibilityInput = document.getElementById("publish-modal-visibility");
  const livedateInput = document.getElementById("publish-modal-livedate");
  
  let rawHeaders = {};
  if (headersInput && headersInput.value.trim() !== "") {
    try {
      rawHeaders = JSON.parse(headersInput.value);
    } catch(e) {
      return alert("Invalid JSON in Headers field");
    }
  }
  
  if (titleInput && titleInput.value) rawHeaders.articleTitle = titleInput.value;
  if (subtitleInput && subtitleInput.value) rawHeaders.articleSubtitle = subtitleInput.value;
  
  const tags = (tagsInput && tagsInput.value) ? tagsInput.value.split(',').map(s => s.trim()).filter(s => s) : [];
  const isVisible = visibilityInput ? visibilityInput.checked : true;
  const liveDate = (livedateInput && livedateInput.value) ? livedateInput.value : null;

  try {
    const requestBody = {
      payload,
      headers: Object.keys(rawHeaders).length > 0 ? JSON.stringify(rawHeaders) : null,
      tags,
      isVisible,
      liveDate
    };

    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    
    if (res.ok) {
      alert("Article published successfully!");
      // Close modal
      let container = context.node;
      while (container && !(container.css?.classes || []).includes("article-creator-panel") && !(container.css?.classes || []).includes("preempt-editor-panel")) {
          container = container.parent;
      }
      if (container) {
        const modalNode = container.findNode({ classes: ["publish-modal-overlay"] });
        if (modalNode) {
          modalNode.css.style.display = "none";
          modalNode.hasChangedSinceRender = true;
          modalNode.render();
        }
      }
    } else {
      const err = await res.json();
      alert("Failed to publish: " + (err.error || "Unknown error"));
    }
  } catch(e) {
    console.error(e);
    alert("Error publishing article.");
  }
}
