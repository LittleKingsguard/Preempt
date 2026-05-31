# Preempt Skill: Styles

## Context
Preempt handles CSS by generating a dynamic, scoped stylesheet during the **Render** phase of the pipeline. Styles are defined natively on `Node` objects using the `css` property and processed via the `StyleNode` class.

## Defining Styles
Instead of hardcoding standard CSS strings, Preempt stores styling rules as objects directly in the `NodeData` schema.

```json
{
  "type": "button",
  "content": "Click Me",
  "css": {
    "style": {
      "backgroundColor": "#ff0000",
      "color": "white",
      "padding": "10px 20px",
      "borderRadius": "5px"
    },
    "hover": {
      "backgroundColor": "#cc0000"
    }
  }
}
```

## Processing and Injection
During rendering:
1. **Server-Side Rendering (SSR)**: Preempt compiles all `StyleNode` definitions into a generic CSS string and injects it into `<style id="preempt-dynamic-styles">` inside the HTML response.
2. **Client-Side (DOM)**: Preempt finds or creates the `<style id="preempt-dynamic-styles">` element, grabs its `CSSStyleSheet` representation, and dynamically injects the CSS rules for every node.

## Dynamic Style Modification
Because styles are an intrinsic part of the pipeline state, you can modify them dynamically inside any Handler. When changing a style via a handler, do not edit the native `element.style` directly. Instead, modify the `Node` configuration:

```javascript
async (event, context) => {
    // 1. Update the underlying virtual node's style
    context.node.data.css.style.backgroundColor = "blue";
    
    // 2. Mark as changed and trigger a DOM flush
    context.node.hasChangedSinceRender = true;
    context.node.render();
}
```
This ensures your changes survive pipeline rebuilds (hydration, reset, etc.) seamlessly.
