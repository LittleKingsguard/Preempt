(event, context) => {
  console.log("Executing handler: applyBold");
  document.execCommand('bold', false, null);
}
