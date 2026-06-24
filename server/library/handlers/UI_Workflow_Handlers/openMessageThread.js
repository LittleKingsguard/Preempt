(event, context) => {
  const listId = context.node.data.props["data-list-id"];
  const mainContainer = context.node.parent.parent;
  
  mainContainer.children = [];
  mainContainer.data.content = [];
  
  mainContainer.addChild({
    type: "div",
    props: { "listId": listId },
    component: [{ "target": "type", "reference": "messageThread" }]
  });
  mainContainer.render();
}
