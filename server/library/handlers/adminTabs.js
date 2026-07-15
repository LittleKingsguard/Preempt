(event, context) => {
  console.log("Executing handler: adminTabs", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  console.log("DEBUG", context);
  const targetTabClass = event.target.getAttribute("data-tab");
  if (!targetTabClass) return;

  const container = context.node.parent.parent; // The main admin dashboard div
  const allTabs = ["users-tab", "handlers-tab", "content-tab", "batches-tab", "settings-tab"];

  allTabs.forEach(tabClass => {
    const tabNode = container.findNode({ classes: [tabClass] });
    if (tabNode) {
      if (tabClass === targetTabClass) {
        context.clientAPI.modifyNode({ css: { style: { display: "block" } } }, tabNode, () => { }, true);
      } else {
        context.clientAPI.modifyNode({ css: { style: { display: "none" } } }, tabNode, () => { }, true);
      }
    }
  });

  const endpoints = {
    'users-tab': { url: '/api/users', placementName: 'users-data' },
    'handlers-tab': { url: '/api/handlers', placementName: 'handlers-data' },
    'content-tab': { url: '/api/content', placementName: 'content-data' },
    'settings-tab': { url: '/api/settings', placementName: 'settings-data' }
  };

  const endpoint = endpoints[targetTabClass];
  let needsFetch = false;
  if (endpoint) {
    const tabNode = container.findNode({ classes: [targetTabClass] });
    if (tabNode && !tabNode.props.hasFetched) {
      needsFetch = true;
    }
  }

  allTabs.forEach((tabClass, index) => {
    const tabNode = container.findNode({ classes: [tabClass] });
    if (tabNode) {
      const isLast = (index === allTabs.length - 1) && !needsFetch;
      const nextCb = isLast ? undefined : () => { };

      if (tabClass === targetTabClass) {
        context.clientAPI.modifyNode({ css: { style: { display: "block" } } }, tabNode, nextCb, true);
      } else {
        context.clientAPI.modifyNode({ css: { style: { display: "none" } } }, tabNode, nextCb, true);
      }
    }
  });

  if (needsFetch) {
    const tabNode = container.findNode({ classes: [targetTabClass] });
    context.clientAPI.modifyNode({ props: { hasFetched: true } }, tabNode, () => { }, true);
    context.clientAPI.fetchContent({
      url: endpoint.url,
      batchLabel: targetTabClass,
      query: { format: "content" },
      defaultTemplate: {},
      placements: [endpoint.placementName]
    });
  }
}
