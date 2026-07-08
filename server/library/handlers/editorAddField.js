(event, context) => {
  console.log("Executing handler: editorAddField", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  const targetId = event.target.getAttribute("data-target-id");
  const addType = event.target.getAttribute("data-add-type");
  if (!targetId || !addType) return;

  const containerNode = context.rootNode.findNode({ css: { id: targetId } });
  if (!containerNode) return;

  const currentContent = containerNode.content || [];
  const index = Array.isArray(currentContent) ? currentContent.length : 0;
  
  let newRowContent = [];
  const metadata = context.metadata;

  if (addType === "keyvalue") {
    const kKey = `insp_add_${Date.now()}_${index}_k`;
    const vKey = `insp_add_${Date.now()}_${index}_v`;
    metadata[kKey] = "";
    metadata[vKey] = "";
    newRowContent = [
      { type: "input", props: { inputKey: kKey, placeholder: "key" }, css: { classes: ["inspector-input", "inspector-key"] } },
      { type: "input", props: { inputKey: vKey, placeholder: "value" }, css: { classes: ["inspector-input", "inspector-value"] } }
    ];
  } else if (addType === "value" || addType === "string") {
    const vKey = `insp_add_${Date.now()}_${index}_v`;
    metadata[vKey] = "";
    newRowContent = [
      { type: "input", props: { inputKey: vKey, placeholder: "value" }, css: { classes: ["inspector-input", "inspector-value"] } }
    ];
  } else {
    // Array of objects (like components or handlers)
    const keys = addType.split(",");
    newRowContent = keys.map(k => {
      const vKey = `insp_add_${Date.now()}_${index}_${k}`;
      metadata[vKey] = "";
      return {
        type: "input", props: { inputKey: vKey, placeholder: k, "data-array-key": k }, css: { classes: ["inspector-input"] }
      };
    });
  }

  const newRow = {
    type: "div", css: { classes: ["inspector-field-row"] },
    content: newRowContent
  };

  const updatedContent = Array.isArray(currentContent) ? [...currentContent, newRow] : [newRow];
  
  context.clientAPI.modifyNode({ content: updatedContent }, containerNode, undefined, false);
  containerNode.addChild(newRow);
}
