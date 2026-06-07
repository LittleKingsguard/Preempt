# Preempt Skill: Components

## Context
Components in Preempt are reusable, standalone fragments of configurations (like styling presets, handler logic, or default properties). They allow developers to bundle logic and bind it dynamically to a `Node` at runtime.

## Component Definition
A Component is defined by a standard JSON payload that specifies what it injects into the target node. They are stored in the database (`Components` table).

A node declares a dependency on a component by referencing its name and telling the pipeline exactly where in the node schema to inject the payload:

```json
{
  "type": "button",
  "component": [
    { 
      "reference": "PrimaryButtonTheme",
      "target": "css.style"
    },
    {
      "reference": "SubmitFormAction",
      "target": "handlers.click"
    }
  ]
}
```

## Structural Components
In addition to simple logic fragments, Components can act as entire sub-trees or structural widgets (e.g., a "LoginComponent"). By setting the `target` to `"type"` and passing a full `NodeData` JSON payload as the component's value, Preempt will deep-merge the entire structural payload into the hosting node.

When a structural component is applied:
1. **Type**: The hosting node's `type` is replaced by the component's type.
2. **Content (Children)**: The component's `content` array is merged into the hosting node, instantiating full virtual child `Node`s.
3. **Properties**: `css`, `props`, and `handlers` are deeply merged, extending the hosting node with the component's interactive logic and styles.

Example of calling a structural component:
```json
{
  "type": "div",
  "component": [
    {
      "reference": "LoginComponentPayload",
      "target": "type"
    }
  ]
}
```

> [!TIP]
> **Root Content Placement:** If you are injecting a structural component via the database `Content` payload and want it to be placed into a specific Template placement (e.g., `<main>`), do NOT place the component reference at the absolute root of the payload. The root `Content` node itself is never "placed" into the template; instead, its *children* are distributed into the template. 
> 
> Therefore, you must wrap your component inside the root's `content` array so it is treated as a distributable child:
> ```json
> {
>   "content": [
>     {
>       "type": "div",
>       "component": [{ "target": "type", "reference": "MyComponent" }],
>       "placement": { "targetPlacement": ["main"] }
>     }
>   ]
> }
> ```

## Applying Components
During the `Supervisor.assemble()` stage, Preempt traverses the tree and calls `applyComponentsTree()`. 

1. Preempt reads the `reference` property (e.g., `"PrimaryButtonTheme"`).
2. It searches the database-provided component library (merged into the root Node during the `Content` DB fetch) for a matching payload or function body.
3. It assigns the resolved value directly to the path specified by `target` using deep injection (e.g., `target: "handlers.click"` injects the resolved string into `node.data.handlers.click`).

> [!WARNING]
> **Handler Mapping Requirement:** When a structural component's payload references a handler (e.g., `"reference": "MyHandler"`), that handler MUST be mapped to the component in the `componenthandlers` database table. If it is not mapped, the backend will not send the handler's function body to the client. This will result in silent interaction failures on the frontend because the payload will point to a non-existent function.

## Creating and Editing Components
Components are created and modified globally via the Admin API.

1. **Creating**: Issue a `POST` request to `/api/components` with `name` and `payload`. The `payload` can be a raw JavaScript string (for handlers) or an object (for styles/props).
2. **Editing**: Issue a `PUT` request to `/api/components/:id` with the updated payload.

Because components are merged mid-pipeline, updating a component globally updates the behavior of all nodes that reference it across the entire site on the next render.
