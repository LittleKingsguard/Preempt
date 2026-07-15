(event, context) => {
  event.stopPropagation();
  const metadata = window.Preempt.metadata || {};
  const targetType = metadata.editor_detail_pane_type;
  const targetRef = metadata.editor_detail_pane_ref;
  const content = metadata.editor_detail_pane_content;
  const targetNode = metadata.editor_detail_pane_node;

  if (targetType === "handler") {
    const compiled = context.clientAPI.compileHandler(targetRef, content);
    if (compiled) {
      if (targetNode) {
        if (!targetNode.compiledHandlers) targetNode.compiledHandlers = {};
        targetNode.compiledHandlers[targetRef] = compiled;
        
        if (targetNode.data.handlers && targetNode.data.handlers[targetRef]) {
          targetNode.data.handlers[targetRef].body = content;
        } else {
          const eventBinding = targetNode.component?.find(c => c.reference === targetRef && c.target?.startsWith("handlers."));
          if (eventBinding) {
             eventBinding.value = { name: targetRef, body: content };
             const eventName = eventBinding.target.substring(9);
             if (targetNode.data.handlers && targetNode.data.handlers[eventName]) {
                targetNode.data.handlers[eventName].body = content;
             }
          }
        }
      }
      context.clientAPI.handlers[targetRef] = compiled;
      alert("Handler updated locally for testing.");
    } else {
      alert("Failed to compile handler.");
    }
  } else if (targetType === "component") {
    try {
      const payload = JSON.parse(content);
      if (targetNode) {
        const binding = targetNode.component?.find(c => c.reference === targetRef);
        if (binding) {
          binding.value = payload;
          alert("Component updated locally for testing.");
        } else {
          alert("Could not find component binding on the cached node.");
        }
      }
    } catch (err) {
      alert("Invalid JSON for component.");
    }
  }
  
  context.clientAPI.rerun();
}
