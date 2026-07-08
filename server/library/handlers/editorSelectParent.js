(event, context) => {
  console.log("Executing handler: editorSelectParent");
  event.stopPropagation();
  const node = window.Preempt.inspectedNode;
  if (node && node.parent) {
      window.Preempt.inspectedNode = node.parent;
      context.clientAPI.modifyNode({}, node.parent, undefined, false);
  }
}
