(event, context) => {
  console.log("Executing handler: EditorInspectHandler", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  event.stopPropagation();
  let node = context.node;
  if (!window.Preempt) window.Preempt = {};
  window.Preempt.inspectedNode = node;
  
  const data = node.data;
  const metadata = context.metadata;

  const updateContainer = (container, contentArr) => {
    context.clientAPI.modifyNode({ content: contentArr }, container, undefined, false);
    container.children = [];
    if (container.element) container.element.innerHTML = "";
    contentArr.forEach(c => container.addChild(c));
  };

  // Populate Props
  const propsContainer = context.rootNode.findNode(n => n.css?.id === "inspector-props-fields");
  if (propsContainer) {
    const keys = Object.keys(data.props || {});
    const propsContent = keys.map((key, index) => {
      const kKey = `insp_props_${index}_k`;
      const vKey = `insp_props_${index}_v`;
      metadata[kKey] = key;
      metadata[vKey] = typeof data.props[key] === "object" ? JSON.stringify(data.props[key]) : data.props[key];
      return {
        type: "div", css: { classes: ["inspector-field-row"] },
        content: [
          { type: "input", props: { inputKey: kKey, placeholder: "key" }, css: { classes: ["inspector-input", "inspector-key"] } },
          { type: "input", props: { inputKey: vKey, placeholder: "value" }, css: { classes: ["inspector-input", "inspector-value"] } }
        ]
      };
    });
    updateContainer(propsContainer, propsContent);
  }

  // Populate CSS Style
  const cssStyleContainer = context.rootNode.findNode(n => n.css?.id === "inspector-css-fields");
  if (cssStyleContainer) {
    const keys = Object.keys(data.css?.style || {});
    const styleContent = keys.map((key, index) => {
      const kKey = `insp_css_${index}_k`;
      const vKey = `insp_css_${index}_v`;
      metadata[kKey] = key;
      metadata[vKey] = typeof data.css.style[key] === "object" ? JSON.stringify(data.css.style[key]) : data.css.style[key];
      return {
        type: "div", css: { classes: ["inspector-field-row"] },
        content: [
          { type: "input", props: { inputKey: kKey, placeholder: "property" }, css: { classes: ["inspector-input", "inspector-key"] } },
          { type: "input", props: { inputKey: vKey, placeholder: "value" }, css: { classes: ["inspector-input", "inspector-value"] } }
        ]
      };
    });
    updateContainer(cssStyleContainer, styleContent);
  }

  // Populate CSS Classes
  const cssClassesContainer = context.rootNode.findNode(n => n.css?.id === "inspector-css-classes-fields");
  if (cssClassesContainer) {
    const classes = data.css?.classes || [];
    const classesContent = classes.map((cls, index) => {
      const vKey = `insp_class_${index}_v`;
      metadata[vKey] = cls;
      return {
        type: "div", css: { classes: ["inspector-field-row"] },
        content: [
          { type: "input", props: { inputKey: vKey, placeholder: "class" }, css: { classes: ["inspector-input", "inspector-value"] } }
        ]
      };
    });
    updateContainer(cssClassesContainer, classesContent);
  }

  // Populate Components
  const compContainer = context.rootNode.findNode(n => n.css?.id === "inspector-components-fields");
  if (compContainer) {
    const comps = data.component || [];
    const compContent = comps.map((comp, index) => {
      const refKey = `insp_comp_${index}_ref`;
      const tarKey = `insp_comp_${index}_tar`;
      metadata[refKey] = comp.reference || "";
      metadata[tarKey] = comp.target || "";
      return {
        type: "div", css: { classes: ["inspector-field-row"] },
        content: [
          { type: "input", props: { inputKey: tarKey, placeholder: "target", "data-array-key": "target" }, css: { classes: ["inspector-input"] } },
          { type: "input", props: { inputKey: refKey, placeholder: "reference", "data-array-key": "reference" }, css: { classes: ["inspector-input"] } }
        ]
      };
    });
    updateContainer(compContainer, compContent);
  }

  // Populate Handlers
  const handContainer = context.rootNode.findNode(n => n.css?.id === "inspector-handlers-fields");
  if (handContainer) {
    const keys = Object.keys(data.handlers || {});
    const handContent = keys.map((key, index) => {
      const evtKey = `insp_hand_${index}_evt`;
      const refKey = `insp_hand_${index}_ref`;
      metadata[evtKey] = key;
      metadata[refKey] = data.handlers[key];
      return {
        type: "div", css: { classes: ["inspector-field-row"] },
        content: [
          { type: "input", props: { inputKey: evtKey, placeholder: "event", "data-array-key": "event" }, css: { classes: ["inspector-input"] } },
          { type: "input", props: { inputKey: refKey, placeholder: "reference", "data-array-key": "reference" }, css: { classes: ["inspector-input"] } }
        ]
      };
    });
    updateContainer(handContainer, handContent);
  }

  // Populate Placements
  const placeContainer = context.rootNode.findNode(n => n.css?.id === "inspector-placements-fields");
  if (placeContainer) {
    const places = data.placement?.targetPlacement || [];
    const placeContent = places.map((place, index) => {
      const vKey = `insp_place_${index}_v`;
      metadata[vKey] = place;
      return {
        type: "div", css: { classes: ["inspector-field-row"] },
        content: [
          { type: "input", props: { inputKey: vKey, placeholder: "value" }, css: { classes: ["inspector-input", "inspector-value"] } }
        ]
      };
    });
    updateContainer(placeContainer, placeContent);
  }

  // Populate Children
  const childContainer = context.rootNode.findNode(n => n.css?.id === "inspector-children-fields");
  if (childContainer) {
    let childContent = [];
    if (Array.isArray(node.content)) {
      childContent = node.content.map((child, idx) => ({
        type: "div",
        css: { classes: ["inspector-field-row"] },
        content: [
          { type: "span", content: `${idx}: ${child.data?.type || 'text'}`, css: { classes: ["inspector-label"] } },
          { type: "button", content: "Up", props: { "data-child-index": idx, "data-direction": "-1" }, component: [{target: "handlers.click", reference: "editorReorderChild"}], css: { classes: ["editor-btn"] } },
          { type: "button", content: "Down", props: { "data-child-index": idx, "data-direction": "1" }, component: [{target: "handlers.click", reference: "editorReorderChild"}], css: { classes: ["editor-btn"] } },
          { type: "button", content: "Inspect", props: { "data-child-index": idx }, component: [{target: "handlers.click", reference: "editorSelectChild"}], css: { classes: ["editor-btn", "editor-btn-primary"] } }
        ]
      }));
    }
    updateContainer(childContainer, childContent);
  }

  // General & Text Content remain in the main display
  const displayNode = context.rootNode.findNode(n => n.css && n.css.id === "editor-inspector-display");
  if (displayNode) {
    // Preserve the inspector components panel by finding it and keeping it in the children/content
    const existingComponentsPanel = displayNode.children.find(c => c.css?.id === "inspector-components-panel");
    const componentsPanelData = existingComponentsPanel ? existingComponentsPanel.data : {
        "type": "div",
        "css": { "id": "inspector-components-panel", "classes": ["inspector-panel-wrapper"], "style": { "display": "flex", "flexDirection": "column", "gap": "5px" } },
        "content": [
          { "type": "div", "component": [{ "reference": "editorInspectorProps", "target": "type" }] },
          { "type": "div", "component": [{ "reference": "editorInspectorCss", "target": "type" }] },
          { "type": "div", "component": [{ "reference": "editorInspectorChildren", "target": "type" }] },
          { "type": "div", "component": [{ "reference": "editorInspectorComponents", "target": "type" }] },
          { "type": "div", "component": [{ "reference": "editorInspectorHandlers", "target": "type" }] },
          { "type": "div", "component": [{ "reference": "editorInspectorPlacements", "target": "type" }] }
        ]
    };

    const mainContent = [];
    metadata["insp_gen_type"] = data.type || "";
    mainContent.push({
      type: "details",
      props: { open: "true" },
      css: { classes: ["inspector-details"] },
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
      mainContent.push({
        type: "details",
        css: { classes: ["inspector-details"] },
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

    mainContent.push(componentsPanelData);
    updateContainer(displayNode, mainContent);
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
