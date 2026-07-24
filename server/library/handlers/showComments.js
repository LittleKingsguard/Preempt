(event, context) => {
  console.log("Executing handler: showComments", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const container = context.node.parent;
  
  const buttonCss = context.node.css || {};
  const buttonStyle = buttonCss.style || {};
  context.node.receiveNextState({
    css: {
      ...buttonCss,
      style: { ...buttonStyle, display: "none" }
    }
  });

  const existingChildren = container.children || [];
  container.receiveNextState({
    children: [
      ...existingChildren,
      {
        type: "component",
        props: { name: "commentsContainer" }
      }
    ]
  });
}
