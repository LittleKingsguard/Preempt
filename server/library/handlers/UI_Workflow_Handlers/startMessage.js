async (event, context) => {
  const targetUser = context.node.data.props["data-target-user"];
  if (!targetUser) return;
  
  try {
    const res = await fetch("/api/messages/create_chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ users: [targetUser], listName: `Chat with ${targetUser}` })
    });
    
    if (res.ok) {
      window.location.href = "/messages";
    } else {
      alert("Failed to start message.");
    }
  } catch (err) {
    console.error(err);
  }
}
