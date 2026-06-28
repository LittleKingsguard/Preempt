(event, context) => {
  const display = document.getElementById("editor-inspector-display");
  if (!display) return alert("No inspector found");
  
  try {
    const payload = JSON.parse(display.innerText);
    const tagsInput = document.getElementById("template-tags");
    const tags = (tagsInput && tagsInput.value) ? tagsInput.value.split(',').map(s => s.trim()).filter(s => s) : [];

    fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, tags })
    })
    .then(res => {
      if (res.ok) alert("Template saved successfully!");
      else alert("Failed to save template.");
    })
    .catch(err => alert("Error saving template."));
  } catch (err) {
    alert("Invalid JSON data in inspector.");
  }
}
