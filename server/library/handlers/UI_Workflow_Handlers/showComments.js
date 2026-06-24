(event, context) => {
  const container = context.node.parent;
  
  // Hide the button
  context.node.data.css = context.node.data.css || {};
  context.node.data.css.style = context.node.data.css.style || {};
  context.node.data.css.style.display = "none";
  context.node.hasChangedSinceRender = true;

  // Add the commentsContainer component
  container.addChild({
    type: "component",
    props: { name: "commentsContainer" }
  });

  container.render();
}
