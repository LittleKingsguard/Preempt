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
- `context.node.findNode(query)`: Recursively searches children for a node matching the query (e.g., `{ classes: ['login-form-wrapper'] }`).
- `context.node.findNodes(query)`: Returns an array of all matching nodes.

**Example Traversal (Best Practice):**
```javascript
// Navigating up to the top-level container safely, then finding a specific child by class name.
// AVOID hardcoded DOM parent jumps (e.g. `context.node.parent.parent`) as they break when 
// nested layers change (like adding a layout wrapper).
// Instead, iterate upwards until a known root structural class is found.
let container = context.node;
while (container && !(container.data.css?.classes || []).includes("login-component-container")) {
    container = container.parent;
}
if (!container) container = context.node.parent.parent; // fallback

// AVOID hardcoded array indices (e.g., container.children[1]) 
// because structural changes (like adding a new tab) will break hardcoded index logic!
// ALWAYS prefer findNode().
const loginFormNode = container.findNode({ classes: ["login-form-wrapper"] });
```

### Best Practice: Structural Component Handlers
When writing a handler that needs to read from or alter multiple specific nodes (such as reading the username and password fields during a login method), the **best practice** is to attach the handler directly to a high-level **structural component** (e.g., the parent `div` that wraps the form) rather than binding it to a deeply nested button.

By binding the handler to the common ancestor component:
1. You guarantee that all required child nodes exist in the `node.children` array when the handler is executed.
2. Traversal becomes much simpler and more robust, because you only need to traverse downwards (`context.node.children[...]`) instead of unpredictably jumping up and across the tree from a nested trigger element.

## Making Changes That Persist Through Renders
If a handler only modifies the native DOM element directly (e.g., `event.target.style.display = 'none'`), the change will be wiped out if the Preempt pipeline ever re-evaluates and rebuilds the DOM (for example, when clicking an element in the Editor mode triggers the `EditorInspectHandler` which runs `Supervisor.resetInstantiation()`).

To make changes that persist through pipeline re-renders (or explicitly manage temporary state), you should use the managed **`context.clientAPI.modifyNode`** function rather than mutating `node.data` manually.

### The `modifyNode` API
```javascript
context.clientAPI.modifyNode(partialNode, targetNode, nextCallback, persistentFlag)
```
- **`partialNode`**: An object containing the properties to update (e.g., `{ css: { style: { display: "block" } } }`).
- **`targetNode`**: The `Node` instance you want to modify (e.g., found via `context.node.findNode()`).
- **`nextCallback`**: Optional callback function to run after the modification.
- **`persistentFlag`**: `true` for persistent changes, `false` for temporary changes. (Defaults to `false` if the Supervisor is currently running, `true` otherwise).

**Temporary Modifications:**
If `persistentFlag` is `false`, the changes are strictly applied to the runtime `Node` object and re-rendered immediately. This is useful for UI state like highlighting an active tab or showing an editor overlay, where you *don't* want the changes written to the underlying JSON source of truth.

**Persistent Modifications:**
If `persistentFlag` is `true`, the changes are deep-merged into the foundational `node.data` source block, and the entire Supervisor pipeline is re-run (`Supervisor.rerun()`). This ensures the change permanently survives pipeline re-instantiation.

**Example Implementation:**
```javascript
async (event, context) => {
    // 1. Traverse to find the target node safely using an upward loop and findNode
    let container = context.node;
    while (container && !(container.css?.classes || []).includes("login-component-container")) {
        container = container.parent;
    }
    const loginFormNode = container.findNode({ classes: ["login-form-wrapper"] });
    
    if (loginFormNode) {
        // 2. Use ClientAPI to modify the node
        // Setting persistent=false makes this a temporary UI transition
        const newCss = { ...loginFormNode.css, style: { ...loginFormNode.css?.style, display: "block" } };
        
        context.clientAPI.modifyNode(
            { css: newCss },
            loginFormNode,
            undefined,
            false // temporary modification
        );
    }
}
```

## Component Handler Mapping Requirement
For a handler function to be successfully loaded and sent to the frontend, it is **not enough** to just reference it by name in a component's JSON payload (e.g. `"reference": "MyHandler"`).

The handler MUST be explicitly mapped to the structural Component in the `componenthandlers` table in the database. When the backend resolves the payload, it only looks up handlers that are formally joined to that component in the database. If the mapping is missing, the frontend will silently fail on interaction because the JavaScript function body was never sent to the client.

By following this exact pattern, your UI state changes will successfully survive pipeline re-renders caused by the `Supervisor`.

## Pipeline Lifecycle Handlers

While interaction handlers (like `click`) fire based on user actions, Preempt also supports execution hooks tied directly to the lifecycle stages of the rendering pipeline.

You can bind handlers to specific phases of the `Supervisor` pipeline. When defining a node, you can add these hooks to the `handlers` object (e.g., `"beforeRender": "async (context) => { ... }"`).

### Available Lifecycle Hooks
> [!WARNING]
> **Strict Phase Naming:** Only use the exact string keys listed below (e.g., `beforePreprocess`, `afterAssembly`). Do NOT invent or guess lifecycle phases like `init`, `preprocess`, or `postprocess`. If a string key doesn't exactly match the phases below, the handler will **never execute**.

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

## State Management Between Form Steps (Avoiding Race Conditions)

When building complex multi-step workflows within a single structural component (e.g., transitioning from a Login form to a 2FA form, or from Registration to Email Verification), you often need to pass state (like a `username`) from the first step to the second step.

**Anti-Pattern (Causes Race Conditions):**
Do NOT inject state directly into hidden native DOM inputs via DOM manipulation during a handler:
```javascript
// AVOID THIS! It will be wiped by the pipeline during re-rendering/hydration.
const twoFaForm = container.children[4].domNode.querySelector('form');
twoFaForm.querySelector('[name=username]').value = data.username;
```
Because Preempt relies on its virtual `Node` tree as the source of truth, any manual DOM injections will be wiped out when the `Supervisor` triggers a re-render or hydrates the component.

**Best Practice:**
To safely persist state across form steps and pipeline renders, use the browser's `localStorage` as an intermediary cache.

1. **Set the state in the initial handler:**
```javascript
// LoginHandler.js
localStorage.setItem('preempt_2fa_username', data.username);
// Trigger the UI transition...
loginFormNode.data.css.style.display = "none";
twoFaFormNode.data.css.style.display = "block";
twoFaFormNode.hasChangedSinceRender = true;
```

2. **Read the state in the subsequent handler:**
```javascript
// Verify2FAHandler.js
// Fallback to localStorage if the native input is empty/wiped
const username = form.querySelector("[name=username]").value || localStorage.getItem('preempt_2fa_username');
```

This guarantees your state survives any unexpected DOM rehydrations triggered by the pipeline monitoring loop.

## Fetching Data and New Content

When a handler needs to load new content from an API (like loading a new tab's content or fetching dynamic JSON data), you should **always prefer `context.fetchContent()`** over standard `fetch()`.

`context.fetchContent({ url, batchLabel, query, defaultTemplate, placements })` is a managed method that:
1. Automatically retrieves the database record.
2. Extracts its inner `payload` and securely preserves important wrapper metadata (like `author_id` or configuration data).
3. Processes the JSON into valid virtual `Node` instances.
4. Correctly applies target `placements` to inject the new nodes into existing template drop-zones.
5. Automatically restarts the rendering pipeline (`Supervisor.rerun()`) to reflect the changes in the UI.

Using standard `fetch()` would require you to manually handle payload parsing, metadata extraction, Node instantiation, and tree traversal to attach the nodes—all of which is error-prone.

## Accessing Current User Data
Because the Server-Side Render pipeline injects the active user into the root payload, you can access the current user's profile and preferences (like their custom `home_page` route) in any handler by inspecting the `userData` object on the root Content Node.

```javascript
async (event, context) => {
    // Traverse up to the root node
    let root = context.node;
    while (root.parent) root = root.parent;
    
    const currentUser = root.data.userData;
    if (currentUser) {
        console.log(`Welcome back, ${currentUser.username}!`);
    }
}
```

## Real-Time Subscriptions via WebSocket

Because handler functions are evaluated as strings dynamically at runtime, they execute within the local scope where they are instantiated but also have full access to the global `window` object.

You can establish a real-time WebSocket subscription directly from a handler by utilizing the globally exposed `WebSocketClient` instance. Because the `window` object only exists in the browser, you **must** wrap your logic in a check (e.g., `typeof window !== 'undefined'`) to prevent crashes during Server-Side Rendering (SSR). Alternatively, you can bind the logic to a client-only lifecycle hook like `beforeMonitor`.

**Example:**
```javascript
"function(event, context) {
    // Prevent execution during Server-Side Rendering (SSR)
    if (typeof window === 'undefined') return;

    const ws = window.Preempt.WebSocketClient.getInstance();
    
    // Establish a subscription to a specific topic (e.g. commentList ID)
    ws.subscribe('commentList:1', (payload) => {
        // The payload typically contains the fully compiled Node component 
        // returned by the backend in real-time.
        
        console.log('Received real-time update payload:', payload);
        
        // You can programmatically attach the payload as a new child 
        // to the current node context or re-process it through the Supervisor.
        // e.g. window.Preempt.Supervisor.processComponent(payload, context.node);
    });
}"
```
