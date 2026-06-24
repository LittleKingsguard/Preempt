(event, context) => {
  const url = prompt("Enter URL:", "https://");
  if (url) {
    document.execCommand('createLink', false, url);
  }
}
