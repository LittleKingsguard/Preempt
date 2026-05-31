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

### Best Practice: Structural Component Handlers
When writing a handler that needs to read from or alter multiple specific nodes (such as reading the username and password fields during a login method), the **best practice** is to attach the handler directly to a high-level **structural component** (e.g., the parent `div` that wraps the form) rather than binding it to a deeply nested button.

By binding the handler to the common ancestor component:
1. You guarantee that all required child nodes exist in the `node.children` array when the handler is executed.
2. Traversal becomes much simpler and more robust, because you only need to traverse downwards (`context.node.children[...]`) instead of unpredictably jumping up and across the tree from a nested trigger element.

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

## Pipeline Lifecycle Handlers

While interaction handlers (like `click`) fire based on user actions, Preempt also supports execution hooks tied directly to the lifecycle stages of the rendering pipeline.

You can bind handlers to specific phases of the `Supervisor` pipeline. When defining a node, you can add these hooks to the `handlers` object (e.g., `"beforeRender": "async (context) => { ... }"`).

### Available Lifecycle Hooks
1. **`onDBLoad`**: Runs immediately after the pipeline configuration is pulled from the database (Server-Side Rendering stack only). Useful for injecting server-side data (like fetching recent articles) via `context.supervisor.serverApi`.
2. **`afterInstantiate`**: Runs after nodes are initially constructed from JSON but before placement resolution or component injection.
3. **`beforeAssembly` / `afterAssembly`**: Wraps the assembly phase where content nodes are reparented into template target placements and component references are resolved.
4. **`beforePreprocess` / `afterPreprocess`**: Wraps custom pre-processing logic algorithms.
5. **`beforeValidate` / `afterValidate`**: Wraps the validation check. If validation fails, the pipeline halts.
6. **`beforeRender` / `afterRender`**: Wraps the actual DOM manipulation or SSR string generation stage.
7. **`beforePostprocess` / `afterPostprocess`**: Wraps final post-render application logic.
8. **`beforeMonitor`**: Executes right before the `Supervisor` begins the recursive infinite loop to monitor for reactive UI state changes.
9. **`onPause` / `onResume`**: Executes when the monitoring loop is actively paused (often by an editor tool) or resumed by the runtime.

### Context in Lifecycle Hooks
When a lifecycle handler runs, `context` contains:
- `context.supervisor`: The main pipeline `Supervisor` singleton instance. You can access `Supervisor.currentStage` to check the execution status, or invoke backend APIs via `context.supervisor.serverApi` if running in an SSR environment.
- `context.node`: The specific `Node` on the virtual DOM tree currently executing the handler.
