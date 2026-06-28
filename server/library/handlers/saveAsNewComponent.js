(event, context) => {
  const display = document.getElementById("editor-inspector-display");
  if (!display) return alert("No inspector found");
  
  try {
    const payload = JSON.parse(display.innerText);
    const name = prompt("Enter a name for the new component:");
    if (!name) return;

    fetch("/api/components", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload })
    })
    .then(res => {
      if (res.ok) alert("Component saved successfully!");
      else alert("Failed to save component.");
    })
    .catch(err => alert("Error saving component."));
  } catch (err) {
    alert("Invalid JSON data in inspector.");
  }
}
