(event, context) => {
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
    'users-tab': { url: '/api/users?format=content', placementName: 'users-data' },
    'handlers-tab': { url: '/api/handlers?format=content', placementName: 'handlers-data' },
    'content-tab': { url: '/api/content?format=content', placementName: 'content-data' },
    'settings-tab': { url: '/api/settings?format=content', placementName: 'settings-data' }
  };

  const endpoint = endpoints[targetTabClass];
  if (endpoint) {
    const tabNode = container.findNode({ classes: [targetTabClass] });
    if (tabNode && !tabNode.data.hasFetched) {
      tabNode.data.hasFetched = true;
      fetch(endpoint.url)
        .then(res => res.json())
        .then(data => {
          if (!Array.isArray(data)) {
            if (data && typeof data === 'object' && !('error' in data)) {
              data = [data];
            } else {
              data = [];
            }
          }
          const placementNode = tabNode.findNode(n => n.data && n.data.placement && n.data.placement.placementName === endpoint.placementName);
          if (placementNode) {
            data.forEach(item => placementNode.addChild(item));
            placementNode.hasChangedSinceRender = true;
            tabNode.render();
          }
        })
        .catch(err => {
          console.error(`Failed to fetch data for ${targetTabClass}:`, err);
        });
    }
  }
}

