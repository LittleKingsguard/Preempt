(event, context) => {
  console.log("Executing handler: editorSelectChild");
  event.stopPropagation();
  const node = window.Preempt.inspectedNode;
  if (node && Array.isArray(node.content)) {
      const idx = parseInt(event.target.getAttribute("data-child-index"));
      const childNode = node.content[idx];
      if (childNode) {
          window.Preempt.inspectedNode = childNode;
          context.clientAPI.modifyNode({}, childNode, undefined, false);
      }
  }
}
