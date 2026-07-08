(event, context) => {
  console.log("Executing handler: insertLink", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const url = prompt("Enter URL:", "https://");
  if (url) {
    document.execCommand('createLink', false, url);
  }
}
