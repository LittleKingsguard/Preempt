# Preempt Skill: Placements

## Context
Placements are Preempt's mechanism for injecting dynamic content into a static Template. During the **Assembly** stage of the pipeline (`Supervisor.assemble()`), Preempt matches source nodes from the `Content` array to target nodes in the `Template` tree based on their placement configurations.

## Defining Target Placements
To define a drop-zone in a Template, use the `placementName` property inside the `placement` object on a node.

```json
{
  "type": "main",
  "placement": {
    "placementName": "main-content"
  }
}
```

## Assigning Source Placements
When defining a `Content` payload, the root array elements must indicate where they belong by setting `targetPlacement`. This is an array, meaning a single node could theoretically match multiple potential drop-zones (Preempt will pick the first match it finds in the template tree).

```json
{
  "type": "article",
  "placement": {
    "targetPlacement": ["main-content"]
  },
  "content": "This article will be placed inside the <main> tag of the template."
}
```

## The Assembly Process
1. **Instantiation**: Preempt creates `Node` objects for both the Template (root node) and the Content payload (a flat array of floating nodes).
2. **Assembly**: Preempt scans the virtual DOM for nodes with `placementName`. 
3. **Reparenting**: Content nodes with a matching `targetPlacement` string are disconnected from their temporary container and reparented directly as children of the matching target node via `node.placeInto()`.

If a content node fails to find a matching target placement, it is essentially orphaned and will not be rendered to the final DOM unless dynamically modified by a later handler.

## Examples in the Codebase
For a real-world example of complex placement assembly, refer to the Editor system:
- **`server/library/components/editor.json`**: Defines root placement drop-zones for the editor interface, such as `editor-inspector-display`.
- **`server/library/handlers/EditorInspectHandler.js`**: Demonstrates dynamic placement assembly. The handler generates content nodes on the fly with specific `targetPlacement` arrays (e.g., targeting `inspector-components-panel`) and pushes them into a temporary payload via `clientAPI.addContentNodes()`. When the Supervisor reruns the pipeline, it effortlessly routes these dynamically generated nodes into the deeply nested structural components defined in `editor.json`.

## Anti-Patterns & Unsupported Usage
- **Supported Component Placements**: Structural components ARE fully supported to define `placementName` drop-zones inside their sub-tree layout (e.g., `editor.json` providing `editor-inspector-display`).
- **Unsupported Anti-Patterns**:
  1. **Component Nodes Requesting `targetPlacement`**: A component payload should never define `targetPlacement` to place itself *out* of its component hierarchy into an external drop-zone.
  2. **Host Nodes Invoking `type` Components With Placement Children**: A hosting node invoking a `type` component must NOT have children that define placements of either type (`placementName` or `targetPlacement`). Re-assembling or restoring the hosting node to its `node.data` originals replaces the host node's child sub-tree, breaking any placement linkages defined on those host children.
  3. **Ancestor Drop-Zone Duplication Loop**: Defining a `placementName` drop-zone that matches an existing `placementName` in an ancestor node's parent tree is prohibited. `Placement.constructor()` checks the ancestor chain, logs a loop safeguard error, and sets `placementName = undefined`.
  4. **Filtering Placement Targets by `isInTree`**: Using `node.isInTree` to suppress target placement emissions is an anti-pattern because it improperly excludes floating `ContentNode` instances. Use phase parameter passing (`phase = PhaseRegistry.EMIT_NONE`) for component prototype nodes instead.

