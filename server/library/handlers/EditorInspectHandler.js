(event, context) => {
  console.log("Executing handler: EditorInspectHandler", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  let node = context.node;
  if (!window.Preempt) window.Preempt = {};
  window.Preempt.inspectedNode = node;
  
  const data = node.data;
  const metadata = context.metadata;

  let contentNodesBatch = [];

  // Populate Props
  const propsKeys = Object.keys(data.props || {});
  propsKeys.forEach((key, index) => {
    const kKey = `insp_props_${index}_k`;
    const vKey = `insp_props_${index}_v`;
    metadata[kKey] = key;
    metadata[vKey] = typeof data.props[key] === "object" ? JSON.stringify(data.props[key]) : data.props[key];
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-props-fields"] },
      component: [
        { reference: "editorInspectorKeyValueRow", target: "type" },
        { reference: "keyRef", value: kKey },
        { reference: "valRef", value: vKey }
      ]
    });
  });

  // Populate CSS Style
  const cssKeys = Object.keys(data.css?.style || {});
  cssKeys.forEach((key, index) => {
    const kKey = `insp_css_${index}_k`;
    const vKey = `insp_css_${index}_v`;
    metadata[kKey] = key;
    metadata[vKey] = typeof data.css.style[key] === "object" ? JSON.stringify(data.css.style[key]) : data.css.style[key];
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-css-fields"] },
      component: [
        { reference: "editorInspectorKeyValueRow", target: "type" },
        { reference: "keyRef", value: kKey },
        { reference: "valRef", value: vKey }
      ]
    });
  });

  // Populate CSS Classes
  const classes = data.css?.classes || [];
  classes.forEach((cls, index) => {
    const vKey = `insp_class_${index}_v`;
    metadata[vKey] = cls;
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-css-classes-fields"] },
      component: [
        { reference: "editorInspectorValueRow", target: "type" },
        { reference: "valRef", value: vKey }
      ]
    });
  });

  // Populate Components
  const comps = data.component || [];
  comps.forEach((comp, index) => {
    const refKey = `insp_comp_${index}_ref`;
    const tarKey = `insp_comp_${index}_tar`;
    metadata[refKey] = comp.reference || "";
    metadata[tarKey] = comp.target || "";
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-components-fields"] },
      component: [
        { reference: "editorInspectorComponentRow", target: "type" },
        { reference: "tarRef", value: tarKey },
        { reference: "refRef", value: refKey }
      ]
    });
  });

  // Populate Handlers
  const handKeys = Object.keys(data.handlers || {});
  handKeys.forEach((key, index) => {
    const evtKey = `insp_hand_${index}_evt`;
    const refKey = `insp_hand_${index}_ref`;
    metadata[evtKey] = key;
    metadata[refKey] = data.handlers[key];
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-handlers-fields"] },
      component: [
        { reference: "editorInspectorHandlerRow", target: "type" },
        { reference: "evtRef", value: evtKey },
        { reference: "refRef", value: refKey }
      ]
    });
  });

  // Populate Placements
  const places = data.placement?.targetPlacement || [];
  places.forEach((place, index) => {
    const vKey = `insp_place_${index}_v`;
    metadata[vKey] = place;
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-placements-fields"] },
      component: [
        { reference: "editorInspectorValueRow", target: "type" },
        { reference: "valRef", value: vKey }
      ]
    });
  });

  // Populate Children
  if (Array.isArray(node.content)) {
    node.content.forEach((child, idx) => {
      contentNodesBatch.push({
        placement: { targetPlacement: ["inspector-children-fields"] },
        component: [
          { reference: "editorInspectorChildRow", target: "type" },
          { reference: "labelRef", value: `${idx}: ${child.data?.type || 'text'}` },
          { reference: "idxRef", value: idx }
        ]
      });
    });
  }

  // General & Text Content remain in the main display
  const displayNode = context.rootNode.findNode(n => n.css && n.css.id === "editor-inspector-display");
  if (displayNode) {
    metadata["insp_gen_type"] = data.type || "";
    contentNodesBatch.push({
      type: "details",
      props: { open: "true" },
      css: { classes: ["inspector-details"] },
      placement: { targetPlacement: ["editor-inspector-display"] },
      content: [
        { type: "summary", content: "General", css: { classes: ["inspector-summary"] } },
        {
          type: "div", css: { style: { padding: "5px", display: "flex", gap: "5px", flexDirection: "column" } },
          content: [
            {
              type: "div", css: { classes: ["inspector-field-row"] },
              content: [
                { type: "label", content: "Type", css: { classes: ["inspector-label"] } },
                { type: "input", props: { inputKey: "insp_gen_type" }, css: { classes: ["inspector-input"] } }
              ]
            },
            {
              type: "div", css: { style: { display: "flex", gap: "5px", marginTop: "10px" } },
              content: [
                { type: "button", content: "Update General", props: { "data-prop-path": "general" }, component: [{target: "handlers.click", reference: "editorUpdateNodeProp"}], css: { classes: ["editor-btn", "editor-btn-primary"] } },
                (node.parent ? { type: "button", content: "Inspect Parent", component: [{target: "handlers.click", reference: "editorSelectParent"}], css: { classes: ["editor-btn"] } } : null)
              ].filter(Boolean)
            }
          ]
        }
      ]
    });

    if (typeof data.content === "string") {
      metadata["insp_gen_content"] = data.content;
      contentNodesBatch.push({
        type: "details",
        css: { classes: ["inspector-details"] },
        placement: { targetPlacement: ["editor-inspector-display"] },
        content: [
          { type: "summary", content: "Content (Text)", css: { classes: ["inspector-summary"] } },
          {
            type: "div", css: { style: { padding: "5px", display: "flex", gap: "5px", flexDirection: "column" } },
            content: [
              {
                type: "textarea",
                props: { inputKey: "insp_gen_content" },
                css: { classes: ["inspector-input"], style: { minHeight: "100px", width: "100%", boxSizing: "border-box" } }
              },
              { type: "button", content: "Update Content", props: { "data-prop-path": "content" }, component: [{target: "handlers.click", reference: "editorUpdateNodeProp"}], css: { classes: ["editor-btn", "editor-btn-primary"] } }
            ]
          }
        ]
      });
    }

    // We do NOT modify the existing components panel. The panel components in editor.json stay there.
    // We just push the rows to addContentNodes!
    context.clientAPI.addContentNodes(contentNodesBatch, "editor-inspector-rows");
  }

  // Update classes on editor panel
  let isComponent = false;
  let curr = node;
  while (curr) {
    if (curr.isComponentInjected || (curr.component && curr.component.length > 0)) {
      isComponent = true;
      break;
    }
    curr = curr.parent;
  }

  const editorPanelNode = context.rootNode.findNode(n => n.css && n.css.classes && n.css.classes.includes("preempt-editor-panel"));
  if (editorPanelNode) {
    const newClasses = [...(editorPanelNode.css?.classes || [])];
    if (isComponent) {
      if (!newClasses.includes("editor-mode-component")) newClasses.push("editor-mode-component");
      const filtered = newClasses.filter(c => c !== "editor-mode-content" && c !== "editor-mode-template");
      context.clientAPI.modifyNode({ css: { ...editorPanelNode.css, classes: filtered } }, editorPanelNode, undefined, false);
    } else {
      const filtered = newClasses.filter(c => c !== "editor-mode-component");
      const baseMode = (editorPanelNode.props && editorPanelNode.props["data-base-mode"]) ? editorPanelNode.props["data-base-mode"] : "editor-mode-content";
      if (!filtered.includes(baseMode)) filtered.push(baseMode);
      context.clientAPI.modifyNode({ css: { ...editorPanelNode.css, classes: filtered } }, editorPanelNode, undefined, false);
    }
  }

}
