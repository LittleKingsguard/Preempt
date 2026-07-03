(event, context) => {
  console.log("DEBUG", context);
  const targetTabClass = event.target.getAttribute("data-tab");
  if (!targetTabClass) return;

  const container = context.node.parent.parent; // The main admin dashboard div
  const allTabs = ["users-tab", "handlers-tab", "content-tab", "batches-tab", "settings-tab"];

  allTabs.forEach(tabClass => {
    const tabNode = container.findNode({ classes: [tabClass] });
    if (tabNode) {
      if (!tabNode.data.css) tabNode.data.css = {};
      if (!tabNode.data.css.style) tabNode.data.css.style = {};
      if (tabClass === targetTabClass) {
        tabNode.data.css.style.display = "block";
      } else {
        tabNode.data.css.style.display = "none";
      }
      tabNode.hasChangedSinceRender = true;
      tabNode.render();
    }
  });

  const endpoints = {
    'users-tab': { url: '/api/users', placementName: 'users-data' },
    'handlers-tab': { url: '/api/handlers', placementName: 'handlers-data' },
    'content-tab': { url: '/api/content', placementName: 'content-data' },
    'settings-tab': { url: '/api/settings', placementName: 'settings-data' }
  };

  const endpoint = endpoints[targetTabClass];
  if (endpoint) {
    const tabNode = container.findNode({ classes: [targetTabClass] });
    if (tabNode && !tabNode.data.hasFetched) {
      tabNode.data.hasFetched = true;
      context.fetchContent({
        url: endpoint.url,
        batchLabel: targetTabClass,
        query: { format: "content" },
        defaultTemplate: {},
        placements: [endpoint.placementName]
      });
    }
  }
}

