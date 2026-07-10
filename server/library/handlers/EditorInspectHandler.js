(event, context) => {
  console.log("Executing handler: EditorInspectHandler", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  let node = context.node;
  if (!window.Preempt) window.Preempt = {};
  window.Preempt.inspectedNode = node;

  const populator = context.clientAPI.getHandler("EditorPopulateInspector");
  if (populator) {
    populator(event, context);
  } else {
    console.warn("EditorPopulateInspector dynamic handler not found");
  }
}
