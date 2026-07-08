async (context) => {
  console.log("Executing handler: fetchTagsAutocomplete");
  if (typeof window === 'undefined') return; // Only fetch tags client-side
  try {
    const res = await fetch("/api/tags");
    if (!res.ok) return;
    const tagsArray = await res.json();
    
    const datalistNode = context.node.findNode({ props: { id: "tags-datalist" } });
    if (datalistNode) {
      datalistNode.content = tagsArray.map(t => {
        const val = typeof t === "object" ? (t.name || t.tag || t.id) : t;
        return { type: "option", props: { value: val } };
      });
    }
  } catch (err) {
    console.error("Failed to fetch tags for autocomplete:", err);
  }
}
