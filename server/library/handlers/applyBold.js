(event, context) => {
  console.log("Executing handler: applyBold", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  document.execCommand('bold', false, null);
}
