(event, context) => {
  console.log("Executing handler: backToInbox", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const mainContainer = context.node.parent.parent;
  mainContainer.receiveNextState({
    children: [
      {
        type: "div",
        component: [{ "target": "type", "reference": "messageContainer" }]
      }
    ],
    content: undefined
  });
}
