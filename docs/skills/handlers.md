# Preempt Skill: Writing Persistable Handlers

## Context
Handlers are JavaScript functions executed in the browser that respond to user interactions (like `onclick`). In Preempt, handlers have access to the underlying virtual DOM `Node` structure, allowing them to manipulate the UI state directly.

## Accessing the Underlying Node Structure
When a handler is executed by the Preempt runtime, it receives two arguments:
```javascript
async (event, context) => { ... }
```

- `event`: The standard browser `Event` object.
- `context`: An object containing the Preempt execution context.

The most important property is `context.node`, which points to the Preempt `Node` instance that triggered the event.

You can traverse the node tree using:
- `context.node.parent`: The parent `Node`.
- `context.node.children`: An array of child `Node`s.

**Example Traversal:**
```javascript
// Navigating up to a container and down to a specific child
const container = context.node.parent.parent;
const loginFormNode = container.children[1];
```

## Making Changes That Persist Through Renders
If a handler only modifies the native DOM element directly (e.g., `event.target.style.display = 'none'`), the change will be wiped out if the Preempt pipeline ever re-evaluates and rebuilds the DOM (for example, when clicking an element in the Editor mode triggers the `EditorInspectHandler` which runs `Supervisor.resetInstantiation()`).

To make changes that persist through pipeline re-renders, you must modify the underlying `Node` data structure directly, and then explicitly trigger a re-render for the affected nodes.

The `node.data` object holds a reference to the actual JSON configuration that the Preempt pipeline uses during hydration. By mutating `node.data`, you mutate the source of truth in the pipeline.

**Example Implementation:**
```javascript
async (event, context) => {
    // 1. Traverse to find the target node
    const container = context.node.parent.parent;
    const loginFormNode = container.children[1];
    
    // 2. Mutate the target node's JSON data directly
    // This ensures the change survives pipeline re-instantiation
    loginFormNode.data.css.style.display = "block";
    
    // 3. Mark the node as changed
    // This disables the render optimization bypass for this specific node
    loginFormNode.hasChangedSinceRender = true;
    
    // 4. Force the node to flush its new state to the native DOM
    loginFormNode.render();
}
```

By following this exact pattern, your UI state changes will successfully survive pipeline re-renders caused by the `Supervisor`.
