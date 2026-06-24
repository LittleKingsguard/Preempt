(event, context) => {
  const url = prompt("Enter image URL:", "https://");
  if (url) {
    document.execCommand('insertImage', false, url);
  }
}
