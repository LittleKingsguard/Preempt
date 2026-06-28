(event, context) => {
  if (!window.Preempt || !window.Preempt.contentData) return;
  const commentsAllowed = window.Preempt.contentData.props && window.Preempt.contentData.props.commentsAllowed;
  
  if (!commentsAllowed) {
    context.node.data.css = context.node.data.css || {};
    context.node.data.css.style = context.node.data.css.style || {};
    context.node.data.css.style.display = "none";
    context.node.hasChangedSinceRender = true;
    context.node.render();
  }
}
