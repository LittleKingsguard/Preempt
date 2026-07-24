(event, context) => {
  console.log("Executing handler: toggleCommentsButton", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  if (!window.Preempt || !window.Preempt.contentData) return;
  const commentsAllowed = window.Preempt.contentData.props && window.Preempt.contentData.props.commentsAllowed;
  
  if (!commentsAllowed) {
    const currentCss = context.node.css || {};
    const currentStyle = currentCss.style || {};
    context.node.receiveNextState({
      css: {
        ...currentCss,
        style: { ...currentStyle, display: "none" }
      }
    });
  }
}
