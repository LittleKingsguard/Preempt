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

> [!WARNING]
> **Dynamic Component Dependencies:** If a component or handler is only requested dynamically by client-side javascript (for instance, a handler pushing a new component row during execution), the database seeder will NOT detect it as a dependency for the template. As a result, the server will not include it in the `/api/components` payload, and binding will fail. To fix this, you must explicitly declare the component or handler reference in the template JSON (e.g. inside a hidden container) so it is hard-linked and fetched automatically.

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

## Applying Components
During the `Supervisor.assemble()` stage, Preempt traverses the tree and calls `applyComponentsTree()`. 

1. Preempt reads the `reference` property (e.g., `"PrimaryButtonTheme"`).
2. It traverses up the tree to find a matching payload injected by the database.
3. It assigns the resolved value directly to the path specified by `target` using deep injection (e.g., `target: "handlers.click"` injects the resolved string into `node.data.handlers.click`).

> [!WARNING]
> **Component Resolution Caution:** When resolving a component reference by searching up the tree, templates often define empty placeholders (e.g., `{ "reference": "MyComponent" }`) while the SSR payload injects the actual value elsewhere. When implementing custom lookup logic, ALWAYS explicitly check that `value !== undefined`. If you rely on a simple `Array.prototype.find(b => b.reference === "MyComponent")`, it may return the empty template placeholder instead of the injected payload, causing component binding to fail.

> [!WARNING]
> **Handler Mapping Requirement:** When a structural component's payload references a handler (e.g., `"reference": "MyHandler"`), that handler MUST be mapped to the component in the `componenthandlers` database table. If it is not mapped, the backend will not send the handler's function body to the client. This will result in silent interaction failures on the frontend because the payload will point to a non-existent function.

## Reference: Valid Local Targets for Components

When a `Node` declares a component binding in its `component` array, the `target` property defines the exact location or schema property path within the node where the resolved component payload is injected. Component target resolution occurs across two pipeline worker stages: Phase 3 (`ComponentAssemblyWorker` for `"type"`) and Phase 4 (`SlotAssemblyWorker` for non-type targets).

Below is the complete reference list of supported local component targets in Preempt:

| Target Path | Category | Assembly Phase | Expected Payload / Value Type | Description & Injection Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `type` | Structural | Phase 3 (`ComponentAssemblyWorker`) | Single `NodeData` object (prototype sub-tree) | Deep-merges prototype node sub-tree. Replaces host node `type` and injects layers for `props.*`, `css.id`, `css.classes`, `css.style.*`, `css.styleNodes`, `content`, `children`, `handlers`, `placement`, and `component`. *Cannot resolve array payloads.* |
| `content` | Slot / Content | Phase 4 (`SlotAssemblyWorker`) | String / Scalar or `NodeData`/`NodeData[]` | Injects text content scalar into `content` layer. If resolved value contains instantiated nodes (`_instantiatedNodes`), injects virtual child sub-trees into `children` layer. |
| `children` | Children Slot | Phase 4 (`SlotAssemblyWorker`) | `NodeData` or `NodeData[]` (child sub-trees) | Injects virtual child sub-trees into `children` layer. Subject to loop safeguard `Component.isAppliedInAncestors()` to prevent recursive sub-tree assembly. |
| `props` | Properties | Phase 4 (`SlotAssemblyWorker`) | Object dictionary (`Record<string, any>`) | Injects or overwrites the host node's entire `props` object dictionary. |
| `props.<propertyName>` | Property Key | Phase 4 (`SlotAssemblyWorker`) | Any primitive or object property value | Injects value directly onto a specific property key of host node `props` (e.g., `props.disabled`, `props.placeholder`, `props.ariaLabel`). |
| `css` | Style Object | Phase 4 (`SlotAssemblyWorker`) | Object dictionary with `id`, `classes`, `style`, `cssDef` | Injects style declarations into the host node's `css` object structure. |
| `css.id` | Element ID | Phase 4 (`SlotAssemblyWorker`) | String | Injects custom CSS element ID into `node.css.id`. |
| `css.classes` | Class List | Phase 4 (`SlotAssemblyWorker`) | String or `string[]` | Injects class names into `node.css.classes`. |
| `css.style` | Style Dictionary | Phase 4 (`SlotAssemblyWorker`) | Object dictionary (`Record<string, string>`) | Injects CSS style property key-value pairs (e.g., `{ "backgroundColor": "red", "fontSize": "16px" }`). |
| `css.style.<property>` | Style Property | Phase 4 (`SlotAssemblyWorker`) | String / Numeric CSS value | Injects a specific CSS inline style property (e.g., `css.style.color`, `css.style.display`, `css.style.marginTop`). |
| `handlers` | Handlers List | Phase 4 (`SlotAssemblyWorker`) | `HandlerDef` / `Handler` or array | Injects an array of handler definitions into `node.handlers`. |
| `handlers.<eventName>` | Event Binding | Phase 4 (`SlotAssemblyWorker`) | `HandlerDef` or JS string body | Binds event handler logic to a specific DOM event or lifecycle hook (e.g., `handlers.click`, `handlers.submit`, `handlers.beforeAssembly`). |
| `component` | Nested Binding | Phase 4 (`SlotAssemblyWorker`) | `ComponentBinding` or array | Injects nested component bindings onto the target node's `component` array. |

## Creating and Editing Components
Components are created and modified globally via the Admin API.

1. **Creating**: Issue a `POST` request to `/api/components` with `name` and `payload`. The `payload` can be a raw JavaScript string (for handlers) or an object (for styles/props).
2. **Editing**: Issue a `PUT` request to `/api/components/:id` with the updated payload.

Because components are merged mid-pipeline, updating a component globally updates the behavior of all nodes that reference it across the entire site on the next render.

## Examples in the Codebase
For a real-world example of complex structural data injection and component-driven layouts, refer to the Editor system:
- **`server/library/components/editor.json`**: Acts as the primary template structure for the Editor UI. It defines hidden dependencies and leverages structural components (e.g., `{ "reference": "editorInspectorComponents", "target": "type" }`) to assemble the inspector panel.
- **`server/library/components/editorInspectorComponents.json`**: An example of a nested structural component that defines its own layout and drop-zones for child rows.
- **`server/library/handlers/EditorInspectHandler.js`**: Demonstrates how to dynamically push component references (like `editorInspectorComponentRow`) into a node's child array during execution to build complex, data-driven interfaces on the fly.

## Component Assembly Reset & Anti-Patterns
- **Message-Driven Assembly & Reset to `node.data`**: `ComponentAssemblyWorker` and `SlotAssemblyWorker` process node state selectively based on `WorkerMessage` instructions (`createdNew` / `updatedSource`). If an instructed component binding cannot resolve a valid source component (`resolvedValue === null` or missing root node), the assembly worker resets the node (or target property path) back to its original `node.data` definitions.
- **Component Target Anti-Patterns**:
  - **Duplicate Target Components Anti-Pattern**: Defining multiple component bindings on the same node with identical `target` properties (e.g., two component bindings having `target: "type"` or `target: "css.style"`) is an unsupported anti-pattern. `Node.targetComponents` indexes target components by `target` as a key-value Map; duplicate targets log a runtime error (`[Node] Duplicate target component defined for target: ...`) and overwrite prior target bindings.
  - **Array Payload on `"type"` Target Anti-Pattern**: Attempting to pass an array payload (`NodeData[]`) to a component targeting `"type"` causes assembly failure (`Component binding failed: Cannot resolve an array for a 'type' target component.`). Structural `"type"` targets require a single prototype node schema.
- **Component Placement Rules & Anti-Patterns**:
  - **Supported**: Defining `placementName` drop-zones inside a component sub-tree is fully supported (allowing content nodes to be placed *into* the component).
  - **Anti-Pattern 1**: Component nodes attempting to define `targetPlacement` to place themselves *out* of the component.
  - **Anti-Pattern 2**: Hosting nodes that invoke a `type` component containing children with placements of either type (`placementName` or `targetPlacement`). Re-assembling or restoring host nodes replaces child sub-trees, destroying dynamic placement linkages on host children (breaking behavior).
  - **Anti-Pattern 3 (Self-Referential Component Loop)**: Defining a component whose sub-tree child nodes contain component bindings referencing the component itself (creating an infinite recursive component tree). `ComponentAssemblyWorker` and `SlotAssemblyWorker` execute `Component.isAppliedInAncestors(node, component)` during assembly, detecting native sub-tree component loops. `Component.isAppliedInAncestors()` evaluates only target components of type `'type'` or `'content'` and requires ancestor nodes to possess the component in `parentNode.sourceComponents`. *Exception*: Placements have their own infinite loop blocker (`Placement.constructor` safeguard). A component updating `type` or `children` can still resolve if an ancestor has applied it iff `node` is NOT descended strictly through native children (i.e. it crossed a placement boundary).
- **Component Layer Building Rules**:
  - `buildLayerMap()` is NOT called in `Component` constructor; it is called by worker stages (`ComponentAssemblyWorker` / `SlotAssemblyWorker`) during pipeline execution.
  - `buildLayerMap(phase: number, target: string)` requires a target property parameter. Worker stages (`ComponentAssemblyWorker` / `SlotAssemblyWorker`) supply the target property path during assembly.
  - **`target === 'type'`**: Extracts all structural properties (`type`, `props.*`, `css.*`, `content`, `children`, `handlers`, `placement`, `component`) from the prototype node (`protoNode`) into corresponding `NodeLayer`s.
  - **`target === 'content'`**: String values are passed as a `content` layer. However, if `_instantiatedNodes` contains nodes, those nodes are passed as a `children` layer.
  - **Type Checks**:
    - **`target === 'handlers'`**: Requires values to be `Handler` instances or valid `HandlerDef` objects.
    - **`target === 'component'`**: Requires values to be `Component` instances or valid `ComponentBinding` objects.


