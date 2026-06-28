(event, context) => {
  const mainContainer = context.node.parent.parent;
  mainContainer.children = [];
  mainContainer.data.content = [];
  
  mainContainer.addChild({
    type: "div",
    component: [{ "target": "type", "reference": "messageContainer" }]
  });
  mainContainer.render();
}
