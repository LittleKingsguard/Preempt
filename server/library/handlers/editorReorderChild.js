(event, context) => {
  console.log("Executing handler: editorReorderChild", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  const node = window.Preempt.inspectedNode;
  if (!node || !Array.isArray(node.children) || node.children.length === 0) return;

  const idx = parseInt(event.target.getAttribute("data-child-index"));
  const dir = parseInt(event.target.getAttribute("data-direction"));
  
  if (idx + dir < 0 || idx + dir >= node.children.length) return;
  
  const childrenArray = [...node.children];
  const temp = childrenArray[idx];
  childrenArray[idx] = childrenArray[idx + dir];
  childrenArray[idx + dir] = temp;
  
  // Directly mutate the node.children array
  node.children = childrenArray;
  
  // Call modifyNode with an empty partial just to trigger validation and re-render
  context.clientAPI.modifyNode({}, node, undefined, false);
}
