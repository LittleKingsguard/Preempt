(event, context) => {
  console.log("Executing handler: editorSelectNode", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  const targetId = event.currentTarget.getAttribute("data-target-id");
  const targetRef = event.currentTarget.getAttribute("data-target-ref");
  const sourceId = event.currentTarget.getAttribute("data-source-id");
  
  let targetNode = null;
  if (targetRef && sourceId) {
    const sourceNode = context.rootNode.findNode({ css: { id: sourceId } });
    if (sourceNode) {
      const allSourceComps = sourceNode.sourceComponents ? [...Array.from(sourceNode.sourceComponents.values()), ...Array.from(sourceNode.targetComponents.values())] : (sourceNode.component || []);
      const binding = allSourceComps.find(b => b.reference === targetRef);
      targetNode = binding?._instantiatedNodes?.[0];
    }
  } else if (targetId) {
    targetNode = context.rootNode.findNode({ css: { id: targetId } });
    if (!targetNode && context.rootNode.constructor && context.rootNode.constructor.typeComponentNodes) {
      targetNode = context.rootNode.constructor.typeComponentNodes.find(n => n.css?.id === targetId);
    }
  }
  
  if (targetNode) {
      console.log("editorSelectNode: Node found, setting inspectedNode and calling populator");
      window.Preempt.inspectedNode = targetNode;
      const populator = context.clientAPI.getHandler("EditorPopulateInspector");
      if (populator) {
        populator(event, { ...context, node: targetNode });
      }
    } else {
      console.log("editorSelectNode: targetNode NOT FOUND in tree or typeComponentNodes!");
    }
}
