(event, context) => {
  console.log("Executing handler: applyItalic", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  document.execCommand('italic', false, null);
}
