(event, context) => {
  event.stopPropagation();
  const node = context.node;
  if (!window.Preempt) window.Preempt = {};
  window.Preempt.inspectedNode = node;
  
  const display = document.getElementById("editor-inspector-display");
  if (display) {
    display.innerText = JSON.stringify(node.data, null, 2);
  }

  let isComponent = false;
  let curr = node;
  while (curr) {
    if (curr.isComponentInjected || (curr.component && curr.component.length > 0)) {
      isComponent = true;
      break;
    }
    curr = curr.parent;
  }

  const editorPanel = document.querySelector(".preempt-editor-panel");
  if (editorPanel) {
    if (isComponent) {
      editorPanel.classList.add("editor-mode-component");
      editorPanel.classList.remove("editor-mode-content");
      editorPanel.classList.remove("editor-mode-template");
    } else {
      editorPanel.classList.remove("editor-mode-component");
      const baseMode = editorPanel.getAttribute("data-base-mode") || "editor-mode-content";
      editorPanel.classList.add(baseMode);
    }
  }
}
