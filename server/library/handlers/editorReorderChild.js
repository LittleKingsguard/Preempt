(event, context) => {
  console.log("Executing handler: editorReorderChild", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  const node = window.Preempt.inspectedNode;
  if (!node || !node.data || !Array.isArray(node.data.content)) return;

  const idx = parseInt(event.target.getAttribute("data-child-index"));
  const dir = parseInt(event.target.getAttribute("data-direction"));
  
  if (idx + dir < 0 || idx + dir >= node.data.content.length) return;
  
  const contentArray = [...node.data.content];
  const temp = contentArray[idx];
  contentArray[idx] = contentArray[idx + dir];
  contentArray[idx + dir] = temp;
  
  context.clientAPI.modifyNode({ content: contentArray }, node, undefined, false);
}
