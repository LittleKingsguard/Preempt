(event, context) => {
  event.stopPropagation();
  context.clientAPI.addContentNodes([], "editor-modal");
}
