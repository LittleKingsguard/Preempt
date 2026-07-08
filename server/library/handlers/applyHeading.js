(event, context) => {
  console.log("Executing handler: applyHeading");
  document.execCommand('formatBlock', false, 'H2');
}
