(event, context) => {
  console.log("Executing handler: EditorPopulateInspector", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  let node = window.Preempt?.inspectedNode || context.node;
  if (!node) return;
  
  const data = node.data;
  const metadata = context.metadata;

  let contentNodesBatch = [];

  // Populate Props
  const propsKeys = Object.keys(node.props || {});
  propsKeys.forEach((key, index) => {
    const kKey = `insp_props_${index}_k`;
    const vKey = `insp_props_${index}_v`;
    metadata[kKey] = key;
    metadata[vKey] = typeof node.props[key] === "object" ? JSON.stringify(node.props[key]) : node.props[key];
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-props-fields"] },
      component: [
        { reference: "editorInspectorKeyValueRow", target: "type" },
        { reference: "keyRef", value: kKey },
        { reference: "valRef", value: vKey },
        { reference: "keyVal", value: key },
        { reference: "valVal", value: metadata[vKey] }
      ]
    });
  });

  // Populate CSS Style
  const cssKeys = Object.keys(node.css?.style || {});
  cssKeys.forEach((key, index) => {
    const kKey = `insp_css_${index}_k`;
    const vKey = `insp_css_${index}_v`;
    metadata[kKey] = key;
    metadata[vKey] = typeof node.css?.style?.[key] === "object" ? JSON.stringify(node.css.style[key]) : node.css?.style?.[key];
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-css-fields"] },
      component: [
        { reference: "editorInspectorKeyValueRow", target: "type" },
        { reference: "keyRef", value: kKey },
        { reference: "valRef", value: vKey },
        { reference: "keyVal", value: key },
        { reference: "valVal", value: metadata[vKey] }
      ]
    });
  });

  // Populate CSS Classes
  const classes = node.css?.classes || [];
  classes.forEach((cls, index) => {
    const vKey = `insp_class_${index}_v`;
    metadata[vKey] = cls;
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-css-classes-fields"] },
      component: [
        { reference: "editorInspectorValueRow", target: "type" },
        { reference: "valRef", value: vKey },
        { reference: "valVal", value: cls }
      ]
    });
  });

  // Populate Components
  const comps = data.component || [];
  comps.forEach((comp, index) => {
    if (comp.value !== undefined) {
      // It's a definition
      const activeBinding = node.component?.find(b => b.reference === comp.reference);
      const referencingNodes = activeBinding?._referencingNodes || [];
      const isNodeDef = activeBinding?._instantiatedNodes && activeBinding._instantiatedNodes.length > 0;
      
      let mainContent = [];
      if (isNodeDef) {
        const defNode = activeBinding?._instantiatedNodes?.[0];
        if (defNode) {
          mainContent.push({
            type: "button",
            content: "Inspect Component Node",
            props: { "data-target-ref": comp.reference, "data-source-id": node.css?.id || "" },
            component: [{target: "handlers.click", reference: "editorSelectNode"}],
            css: { classes: ["editor-btn", "editor-btn-primary"] }
          });
        } else {
           mainContent.push({ type: "label", content: "Node not instantiated", css: { classes: ["inspector-label"], style: { color: "#d9534f" } } });
        }
      } else {
        if (typeof comp.value === 'object' && comp.value !== null) {
          mainContent.push({
            type: "div", css: { classes: ["inspector-field-row"], style: { flexDirection: "column", alignItems: "flex-start", gap: "5px", padding: "10px", background: "#222", borderRadius: "5px" } },
            content: [
              { type: "label", content: "Component Definition (Not Instantiated Here)", css: { classes: ["inspector-label"], style: { color: "#5bc0de" } } },
              { type: "label", content: `Type: ${comp.value.type || 'N/A'}`, css: { classes: ["inspector-label"], style: { fontWeight: "normal", color: "#ccc" } } },
              { type: "label", content: `Children: ${Array.isArray(comp.value.content) ? comp.value.content.length : (comp.value.content ? 1 : 0)}`, css: { classes: ["inspector-label"], style: { fontWeight: "normal", color: "#ccc" } } }
            ]
          });
        } else {
          const valStr = String(comp.value);
          mainContent.push({
            type: "div", css: { classes: ["inspector-field-row"] },
            content: [
              { type: "label", content: "Value", css: { classes: ["inspector-label"] } },
              { type: "label", content: valStr, css: { classes: ["inspector-label"], style: { fontWeight: "normal", color: "#ccc", wordBreak: "break-all" } } }
            ]
          });
        }
      }

      contentNodesBatch.push({
        type: "details",
        props: { open: "true" },
        css: { classes: ["inspector-details"] },
        placement: { targetPlacement: ["inspector-components-fields"] },
        content: [
          { type: "summary", content: `Def: ${comp.reference}`, css: { classes: ["inspector-summary"] } },
          {
            type: "div", css: { style: { display: "flex", flexDirection: "column", gap: "5px", padding: "5px" } },
            content: [
              ...mainContent,
              ...(referencingNodes.length > 0 ? [
                { type: "label", content: "Referencing Nodes:", css: { classes: ["inspector-label"], style: { marginTop: "5px" } } },
                ...referencingNodes.map(refNode => ({
                  type: "button",
                  content: `Select Node: ${refNode.type} ${refNode.css?.id ? '#' + refNode.css.id : ''}`,
                  props: { "data-target-id": refNode.css?.id || "" },
                  component: [{target: "handlers.click", reference: "editorSelectNode"}],
                  css: { classes: ["editor-btn"] }
                }))
              ] : [])
            ]
          }
        ]
      });
    } else {
      // It's a reference
      let defNode = null;
      let currParent = node.parent;
      while (currParent) {
        if (currParent.component?.some(b => b.reference === comp.reference && b.value !== undefined && b.value !== null)) {
          defNode = currParent;
          break;
        }
        currParent = currParent.parent;
      }
      
      const contentRow = [
        { type: "label", content: `Ref: ${comp.reference}`, css: { classes: ["inspector-label"], style: { width: "auto", flex: "1" } } }
      ];
      
      if (defNode) {
        contentRow.push({
          type: "button",
          content: "Select Def",
          props: { "data-target-id": defNode.css?.id || "" },
          component: [{target: "handlers.click", reference: "editorSelectNode"}],
          css: { classes: ["editor-btn", "editor-btn-primary"] }
        });
      } else {
        contentRow.push({ type: "label", content: "Def Not Found", css: { classes: ["inspector-label"], style: { color: "#d9534f", width: "auto" } } });
      }

      contentNodesBatch.push({
        type: "div", css: { classes: ["inspector-field-row"], style: { padding: "5px", background: "#333", borderRadius: "4px" } },
        placement: { targetPlacement: ["inspector-components-fields"] },
        content: contentRow
      });
    }
  });

  // Populate Handlers
  const handKeys = Object.keys(data.handlers || {});
  handKeys.forEach((key, index) => {
    const evtKey = `insp_hand_${index}_evt`;
    const refKey = `insp_hand_${index}_ref`;
    metadata[evtKey] = key;
    const hData = data.handlers[key];
    const hRef = typeof hData === 'object' && hData !== null && 'name' in hData ? hData.name : hData;
    metadata[refKey] = hRef;
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-handlers-fields"] },
      component: [
        { reference: "editorInspectorHandlerRow", target: "type" },
        { reference: "evtRef", value: evtKey },
        { reference: "evtVal", value: key },
        { reference: "refRef", value: refKey },
        { reference: "refVal", value: hRef }
      ]
    });
  });

  // Populate Placements
  const places = node.placement?.targetPlacement || [];
  places.forEach((place, index) => {
    const vKey = `insp_place_${index}_v`;
    metadata[vKey] = place;
    contentNodesBatch.push({
      placement: { targetPlacement: ["inspector-placements-fields"] },
      component: [
        { reference: "editorInspectorValueRow", target: "type" },
        { reference: "valRef", value: vKey },
        { reference: "valVal", value: place }
      ]
    });
  });

  // Populate Children
  if (node.children && node.children.length > 0) {
    node.children.forEach((child, idx) => {
      contentNodesBatch.push({
        placement: { targetPlacement: ["inspector-children-fields"] },
        component: [
          { reference: "editorInspectorChildRow", target: "type" },
          { reference: "labelRef", value: `${idx}: ${child.type || child.data?.type || 'text'}` },
          { reference: "idxRef", value: idx }
        ]
      });
    });
  }

  // General & Text Content remain in the main display
  const displayNode = context.rootNode.findNode({ css: { id: "editor-inspector-display" } });
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

  const editorPanelNode = context.rootNode.findNode({ classes: ["preempt-editor-panel"] });
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
