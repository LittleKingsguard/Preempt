(event, context) => {
  console.log("Executing handler: editorSelectChild", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  const node = window.Preempt.inspectedNode;
  if (node && Array.isArray(node.content)) {
      const idx = parseInt(event.target.getAttribute("data-child-index"));
      const childNode = node.content[idx];
      if (childNode) {
          window.Preempt.inspectedNode = childNode;
          const populator = context.clientAPI.getHandler("EditorPopulateInspector");
          if (populator) {
            populator(event, { ...context, node: childNode });
          }
      }
  }
}
