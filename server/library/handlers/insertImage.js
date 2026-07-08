(event, context) => {
  console.log("Executing handler: insertImage");
  const url = prompt("Enter image URL:", "https://");
  if (url) {
    document.execCommand('insertImage', false, url);
  }
}
