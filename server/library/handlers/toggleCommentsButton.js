(event, context) => {
  console.log("Executing handler: toggleCommentsButton", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  if (!window.Preempt || !window.Preempt.contentData) return;
  const commentsAllowed = window.Preempt.contentData.props && window.Preempt.contentData.props.commentsAllowed;
  
  if (!commentsAllowed) {
    context.node.css = context.node.css || {};
    context.node.css.style = context.node.css.style || {};
    context.node.css.style.display = "none";
    context.node.hasChangedSinceRender = true;
    context.node.render();
  }
}
