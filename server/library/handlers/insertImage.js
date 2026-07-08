(event, context) => {
  console.log("Executing handler: insertImage", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const url = prompt("Enter image URL:", "https://");
  if (url) {
    document.execCommand('insertImage', false, url);
  }
}
