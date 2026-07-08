async (event, context) => {
  console.log("Executing handler: fetchMessageLists");
  const container = context.node.findNode({ props: { id: "message-lists" } });
  if (!container) return;

  try {
    const res = await fetch("/api/messages");
    if (res.ok) {
      const lists = await res.json();
      
      if (lists.length > 0 && lists[0].payload) {
        lists[0].payload.forEach(item => {
          item.placement = { targetPlacement: ["messageList"] };
        });
        
        window.Preempt.contentData.content = window.Preempt.contentData.content || [];
        window.Preempt.contentData.content.push(...lists[0].payload);
        
        if (lists[0].component) {
          window.Preempt.contentData.component = window.Preempt.contentData.component || [];
          window.Preempt.contentData.component.push(...lists[0].component);
        }
        
        await window.Preempt.Supervisor.process(
          window.Preempt.templateData,
          window.Preempt.contentData,
          window.Preempt.config || window.Preempt.pipelineConfig
        );
      } else {
        container.children = [];
        container.content = [];
        container.addChild({ type: "p", content: "No messages yet." });
        container.render();
      }
    }
  } catch (err) {
    console.error(err);
  }
}
