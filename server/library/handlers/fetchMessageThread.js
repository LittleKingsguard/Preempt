async (event, context) => {
  console.log("Executing handler: fetchMessageThread", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const listId = context.node.props.listId;
  const container = context.node.findNode({ props: { id: "thread-messages" } });
  if (!container || !listId) return;

  try {
    const res = await fetch(`/api/messages/${listId}`);
    if (res.ok) {
      const messages = await res.json();
      
      if (messages.length > 0 && messages[0].payload) {
        messages[0].payload.forEach(item => {
          if (!item.placement || !item.placement.targetPlacement || item.placement.targetPlacement.length === 0) {
            item.placement = { targetPlacement: ["threadMessages"] };
          }
        });
        
        window.Preempt.contentData.content = window.Preempt.contentData.content || [];
        window.Preempt.contentData.content.push(...messages[0].payload);
        
        if (messages[0].component) {
          window.Preempt.contentData.component = window.Preempt.contentData.component || [];
          window.Preempt.contentData.component.push(...messages[0].component);
        }
        
        await window.Preempt.Supervisor.process(
          window.Preempt.templateData,
          window.Preempt.contentData,
          window.Preempt.config || window.Preempt.pipelineConfig
        );
      } else {
        container.children = [];
        container.content = [];
        container.addChild({ type: "p", content: "No messages in this thread yet." });
        container.render();
      }
    }
  } catch (err) {
    console.error(err);
  }
}
