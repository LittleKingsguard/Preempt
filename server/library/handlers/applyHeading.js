(event, context) => {
  console.log("Executing handler: applyHeading", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  document.execCommand('formatBlock', false, 'H2');
}
