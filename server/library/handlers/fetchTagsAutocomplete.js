async (event, context) => {
  console.log("Executing handler: fetchTagsAutocomplete", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  if (typeof window === 'undefined') return; // Only fetch tags client-side
  try {
    const res = await fetch("/api/tags");
    if (!res.ok) return;
    const tagsArray = await res.json();
    
    const datalistNode = context.node.findNode({ props: { id: "tags-datalist" } });
    if (datalistNode) {
      const newContent = tagsArray.map(t => {
        const val = typeof t === "object" ? (t.name || t.tag || t.id) : t;
        return { type: "option", props: { value: val } };
      });
      datalistNode.receiveNextState({ content: newContent });
    }
  } catch (err) {
    console.error("Failed to fetch tags for autocomplete:", err);
  }
}
