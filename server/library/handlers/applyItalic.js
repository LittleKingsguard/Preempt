(event, context) => {
  console.log("Executing handler: applyItalic");
  document.execCommand('italic', false, null);
}
