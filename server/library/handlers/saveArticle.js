async (event, context) => {
  console.log("Executing handler: saveArticle", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const zone = document.getElementById("article-editor-zone");
  const contentHtml = zone ? zone.innerHTML : "";
  try {
    // Simple wrapper payload for raw HTML
    const payload = {
      type: "div",
      props: { innerHTML: contentHtml }
    };
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, tags: ["article", "blog"] })
    });
    if (res.ok) {
      alert("Article published successfully!");
    } else {
      alert("Failed to publish article.");
    }
  } catch(e) {
    console.error(e);
  }
}
