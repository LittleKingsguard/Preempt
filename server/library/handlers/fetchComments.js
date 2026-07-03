async (event, context) => {
  const commentListId = window.Preempt?.contentData?.metadata?.comment_list_id;
  if (!commentListId) return;

  const container = context.node.findNode({ props: { id: "comments-list" } });
  if (!container) return;

  try {
    const res = await fetch(`/api/comments/${commentListId}`);
    if (res.ok) {
      const comments = await res.json();
      
      if (comments.length > 0 && comments[0].payload) {
        comments[0].payload.forEach(item => {
          if (!item.placement || !item.placement.targetPlacement) {
            item.placement = { targetPlacement: ["commentsList"] };
          } else if (item.placement.targetPlacement.includes("end")) {
            item.placement.targetPlacement = item.placement.targetPlacement.map(p => p === "end" ? "commentsList" : p);
          }
        });
        
        window.Preempt.contentData.content = window.Preempt.contentData.content || [];
        window.Preempt.contentData.content.push(...comments[0].payload);
        
        if (comments[0].component) {
          window.Preempt.contentData.component = window.Preempt.contentData.component || [];
          window.Preempt.contentData.component.push(...comments[0].component);
        }
        
        await window.Preempt.Supervisor.process(
          window.Preempt.templateData,
          window.Preempt.contentData,
          window.Preempt.config || window.Preempt.pipelineConfig
        );
      } else {
        container.children = [];
        container.content = [];
        container.addChild({ type: "p", content: "No comments yet. Be the first to comment!" });
        container.render();
      }
    }
  } catch (err) {
    console.error(err);
  }
}
