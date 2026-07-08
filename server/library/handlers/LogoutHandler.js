(event, context) => {
  console.log("Executing handler: LogoutHandler", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  fetch('/api/logout', { method: 'POST' }).then(() => {
    // Redirect to OAuth worker's logout endpoint which redirects to IdP
    window.location.href = '/api/oauth/logout';
  }).catch(err => {
    console.error("Local logout failed", err);
    window.location.href = '/api/oauth/logout';
  });
}
