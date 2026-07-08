(event, context) => {
  console.log("Executing handler: insertLink");
  const url = prompt("Enter URL:", "https://");
  if (url) {
    document.execCommand('createLink', false, url);
  }
}
