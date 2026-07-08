(event, context) => {
  console.log("Executing handler: showComments");
  const container = context.node.parent;
  
  // Hide the button
  context.node.css = context.node.css || {};
  context.node.css.style = context.node.css.style || {};
  context.node.css.style.display = "none";
  context.node.hasChangedSinceRender = true;

  // Add the commentsContainer component
  container.addChild({
    type: "component",
    props: { name: "commentsContainer" }
  });

  container.render();
}
