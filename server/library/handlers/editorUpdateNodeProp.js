(event, context) => {
  console.log("Executing handler: editorUpdateNodeProp", context?.node?.data?.type, context?.node?.css?.id, context?.node?.css?.classes);
  const node = window.Preempt.inspectedNode;
  if (!node) return;

  const propPath = event.target.getAttribute("data-prop-path");
  const targetId = event.target.getAttribute("data-target-id");
  const metadata = context.metadata;
  
  if (propPath === "general") {
    const typeVal = metadata["insp_gen_type"];
    context.clientAPI.modifyNode({ type: typeVal }, node, undefined, false);
  } else if (propPath === "content") {
    const contentVal = metadata["insp_gen_content"];
    context.clientAPI.modifyNode({ content: contentVal }, node, undefined, false);
  } else if (targetId) {
    const structType = event.target.getAttribute("data-struct");
    const containerNode = context.rootNode.findNode({ css: { id: targetId } });
    if (!containerNode) return;
    
    const rows = containerNode.content || [];
    let result = null;
    
    if (structType === "object") {
      result = {};
      rows.forEach(row => {
        if (!row.content) return;
        const keyInput = row.content[0];
        const valInput = row.content[1];
        if (keyInput && valInput && keyInput.props?.inputKey && valInput.props?.inputKey) {
          const k = metadata[keyInput.props.inputKey];
          const v = metadata[valInput.props.inputKey];
          if (k) {
            let finalVal = v;
            try { finalVal = JSON.parse(v); } catch(e) {}
            result[k] = finalVal;
          }
        }
      });
    } else if (structType === "array_of_objects") {
      result = [];
      rows.forEach(row => {
        if (!row.content) return;
        let obj = {};
        let hasData = false;
        row.content.forEach(inp => {
           if (inp.props?.inputKey && inp.props?.["data-array-key"]) {
             const key = inp.props["data-array-key"];
             const v = metadata[inp.props.inputKey];
             if (v) {
                obj[key] = v;
                hasData = true;
             }
           }
        });
        if (hasData) result.push(obj);
      });
    } else if (structType === "array_of_strings") {
      result = [];
      rows.forEach(row => {
        if (!row.content) return;
        const valInput = row.content[0];
        if (valInput && valInput.props?.inputKey) {
          const v = metadata[valInput.props.inputKey];
          if (v) result.push(v);
        }
      });
    }

    if (result !== null) {
      if (propPath === "handlers") {
        const handlersObj = {};
        result.forEach(r => { if (r.event && r.reference) handlersObj[r.reference] = { name: r.reference, event: r.event }; });
        context.clientAPI.modifyNode({ handlers: handlersObj }, node, undefined, false);
      } else if (propPath === "css.style") {
        context.clientAPI.modifyNode({ css: { ...node.data.css, style: result } }, node, undefined, false);
      } else if (propPath === "css.classes") {
        context.clientAPI.modifyNode({ css: { ...node.data.css, classes: result } }, node, undefined, false);
      } else if (propPath === "placement.targetPlacement") {
        context.clientAPI.modifyNode({ placement: [{ ...((node.data.placement && node.data.placement[0]) || {}), targetPlacement: result }] }, node, undefined, false);
      } else {
        context.clientAPI.modifyNode({ [propPath]: result }, node, undefined, false);
      }
    }
  }

  const inspectBinding = window.Preempt.Supervisor.instance.templateData.component?.find(c => c.reference === "EditorInspectHandler");
  if (inspectBinding && inspectBinding.value) {
    const fnStr = String(inspectBinding.value).trim();
    const fakeEvent = { stopPropagation: () => {} };
    if (fnStr.startsWith('(') || fnStr.startsWith('async (')) {
      const fn = new Function('return ' + fnStr)();
      fn(fakeEvent, { ...context, node: node });
    } else {
      const fn = new Function('event', 'context', fnStr);
      fn(fakeEvent, { ...context, node: node });
    }
  }
}
