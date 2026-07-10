(event, context) => {
  console.log("Executing handler: editorSelectParent", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  const node = window.Preempt.inspectedNode;
  if (node && node.parent) {
      window.Preempt.inspectedNode = node.parent;
      const populator = context.clientAPI.getHandler("EditorPopulateInspector");
      if (populator) {
        populator(event, { ...context, node: node.parent });
      }
  }
}
