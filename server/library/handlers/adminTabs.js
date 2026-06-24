(event, context) => {
  const targetTabClass = event.target.getAttribute("data-tab");
  if (!targetTabClass) return;

  const container = context.node.parent.parent; // The main admin dashboard div
  const allTabs = ["users-tab", "handlers-tab", "content-tab", "batches-tab"];

  allTabs.forEach(tabClass => {
    const tabNode = container.findNode({ classes: [tabClass] });
    if (tabNode) {
      if (tabClass === targetTabClass) {
        tabNode.data.css.style.display = "block";
      } else {
        tabNode.data.css.style.display = "none";
      }
      tabNode.hasChangedSinceRender = true;
      tabNode.render();
    }
  });
}
