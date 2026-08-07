---
name: preempt-workflow
description: Explains Preempt's architecture, JSON-driven UI, components, handlers, and the workflow for updating code (rebuilding frontend, database sync/revert). Use this when tasked with building, debugging, or modifying the Preempt application.
---

# Preempt Workflow & Architecture

## Overview
Preempt is a database-driven, JSON-configured virtual DOM and CMS framework. UI state, structure, styles, and logic are defined in JSON stored in a database, allowing zero-deployment updates. 
- **Server-Side Rendering (SSR)** builds the initial DOM.
- **Client-Side hydration** maintains a continuous monitoring loop and handles interactive state.

## Core Development Workflow & Code Changes
When editing Preempt's core files or library files, specific build and sync steps are strictly required:

1. **Frontend Rebuilds (`src/`)**: 
   If you edit any TypeScript files in `src/` (such as `Node.ts`, `ClientAPI.ts`, etc.), the browser will not see your changes until the Vite bundler rebuilds the frontend artifacts. You MUST run:
   ```bash
   bash rebuild_frontend.sh
   ```

2. **Library Reloads (`server/library/`)**: 
   Preempt caches its library of components and handlers in the database for runtime performance. If you manually modify the JSON/JS files in `server/library/` (like `components/editor.json` or `handlers/EditorInspectHandler.js`), the database must be synced for the application to serve the updated logic.
   - Instruct the user to hit `http://localhost/revert` or `http://localhost/sync` in their browser, OR curl the endpoint if necessary.

## Modifying Handlers & ClientAPI
Handlers are JavaScript functions executed in the browser. To modify a node's state during a handler execution:
- Avoid manual direct DOM or `node.data` mutation unless strictly necessary.
- Use `context.clientAPI.modifyNode(partialNode, targetNode, nextCallback, persistentFlag)`:
  - **Temporary modifications (`persistentFlag=false`)**: Applies directly to the runtime Node and immediately re-renders (useful for UI state). Defaults to temporary if Supervisor is actively running.
  - **Persistent modifications (`persistentFlag=true`)**: Deep-merges into the underlying `node.data` JSON and completely reruns the pipeline (`Supervisor.rerun()`).

## The Supervisor Pipeline & PhaseRegistry Rules
The Supervisor orchestrates a worker pipeline:
0. **InstantiationWorker** (`'instantiation'`): Converts raw JSON to OOP Nodes.
1. **TargetPlacementResolverWorker** (`'targetPlacementResolution'`): Resolves `activePlacement` for targetPlacement requests.
2. **PlacementAssemblyWorker** (`'placementAssembly'`): Assembles nodes into `placementName` drop-zones.
3. **ComponentRoutingWorker** (`'componentRouting'`): Routes component binding updates down branches.
4. **ComponentAssemblyWorker** (`'componentAssembly'`): Applies structural component `layerMap` definitions.
5. **SlotAssemblyWorker** (`'slotAssembly'`): Applies non-type component `layerMap` definitions and slot contents.
6. **PreprocessingWorker** (`'preprocessing'`): Executes pre-validation custom hooks (`beforePreprocess`).
7. **ValidationWorker** (`'validation'`): Triggers lazy `node.compile()` and validates required properties before rendering.
8. **SSRElementCreationWorker / ClientElementCreationWorker** (`'elementCreation'`): Renders HTML string fragments or DOM elements.
9. **SSRTreeAssemblyWorker / ClientTreeAssemblyWorker** (`'treeAssembly'`): Mounts DOM element tree or final SSR payload.
10. **PostprocessingWorker** (`'postprocessing'`): Executes post-rendering cleanup hooks (`afterPostprocess`).

### Critical Phase Registry & Locking Rules
- **Dynamic Phase Lookup**: Never hardcode numeric phase literals (`0-9`) in core code or tests. Always use `PhaseRegistry.getPhaseNumber(stageName)` or `Supervisor.emitToPhaseName(caller, node, state, stageName)`. Hardcoding numeric phase literals is a phase order antipattern.
- **Worker Phase Emissions vs `receiveNextState`**: `node.receiveNextState()` is designed for user event handlers, WebSocket updates, and `ClientAPI` calls *after* pipeline worker runs complete. Workers must **never** call `receiveNextState()`. When invoked, `receiveNextState()` checks for **all** registered phase handlers on the host node (`h.phase`), maps them to canonical stage names via `Handler.getStageName(h.phase)`, emits to all matching stage names via `Supervisor.emitToPhaseName()`, and **always emits to `ValidationWorker` (Phase 6 `'validation'`)** to ensure nodes flow through Element Creation and Tree Assembly.
- **Anti-Pattern: Direct Worker Class Emission**: Calling static `.emitTo()` helper methods directly on `Worker` classes (e.g. `PreprocessingWorker.emitTo()`, `PostprocessingWorker.emitTo()`) outside of `Supervisor` is an **unsupported Anti-Pattern**. Only `Supervisor` is permitted to manage worker queues and orchestrate node emissions. All pipeline emissions must be dispatched via `Supervisor.emitToPhase()` or `Supervisor.emitToPhaseName()`.
- **Component Placement Rules & Anti-Patterns**: Components defining `placementName` drop-zones inside their sub-tree is supported. Components defining `targetPlacement` to place themselves *out* of the component hierarchy, or host nodes invoking `type` components while having children with placements of either type, are unsupported Anti-Patterns.
- **Phase Locking Strategy**: Locking for both `ComponentRoutingWorker` (Phase 2) and `ComponentAssemblyWorker` (Phase 3) is deferred until `SlotAssemblyWorker` (Phase 4) locks. This allows slot assembly to inject content nodes with source components that chain backward to routing without triggering lock violations.

### Adding New Workers Without Breaking Changes
To add a new worker stage to the pipeline without breaking existing functionality or hardcoding phase dependencies:
1. **Define Stage Name**: Add the canonical stage name (e.g. `'myNewStage'`) to the `PipelineStage` union type in `src/types/Pipeline.ts`.
2. **Register in `PhaseRegistry`**: Map the stage name and its phase ID in `PhaseRegistry.ts` (or via `PhaseRegistry.registerWorker(stageName, phaseId)`).
3. **Implement Worker**:
   - Extend `BaseWorker`.
   - Assign phase dynamically: `public readonly phase = PhaseRegistry.getPhaseNumber('myNewStage');`.
   - Update node completion status via `node.lastCompletedPhase = PhaseRegistry.getPhaseNumber('myNewStage');`.
   - Forward nodes downstream using `Supervisor.emitToPhaseName(this, node, rollbackState, 'nextStageName')`.
4. **Wire Up Supervisor**:
   - Update the upstream worker's success emission to target `'myNewStage'` via `Supervisor.emitToPhaseName()`.
   - Update `Supervisor.defaultTargetPhase` mappings if property changes target the new stage.
5. **Zero Hardcoded Numbers Rule**: Ensure no raw numeric phase IDs are used in the worker, Supervisor, or tests so pipeline reordering or additions do not cause runtime breaks.

## Important Rules
- Never use `globalThis.Supervisor` as a fallback. `Supervisor` is an import and its singleton should be accessed directly via `Supervisor.instance`.
- **Anti-Pattern Documentation Directive**: Whenever an anti-pattern, unsupported design choice, or prohibited coding practice is mentioned in user feedback, code reviews, or architectural discussions, the agent MUST immediately check `docs/skills/` (and `.agents/skills/`) to verify if it is documented. If missing or incomplete, the agent MUST document the anti-pattern immediately.

## Accessing Advanced Documentation
Detailed technical guidelines exist in the repository under `docs/skills/`. Before making major structural or design changes, you should read the relevant file using the `view_file` tool:
- `docs/skills/overview.md`: Core architecture, Supervisor 10-stage pipeline, PhaseRegistry, and User Auth state.
- `docs/skills/handlers.md`: Advanced handlers, traversal (`findNode`), and state management.
- `docs/skills/components.md`: Component JSON bindings, targets, and references.
- `docs/skills/styles.md`: Dynamic CSS pipeline and programmatic modification.
- `docs/skills/templates.md`: Layout layouts, default wrappers, and drop-zones.
- `docs/skills/placements.md`: Logic for injecting content into template wrappers.
- `docs/skills/testing.md`: Vitest/Playwright testing standards and PhaseRegistry test verification.
