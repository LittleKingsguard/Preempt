# Preempt Skill: Framework Overview

## What is Preempt?
Preempt is a database-driven, JSON-configured virtual DOM and CMS framework. Unlike traditional single-page application frameworks where UI structure is hardcoded in JavaScript/TypeScript components, Preempt defines its entire UI state—including structure, styles, and interaction logic—as JSON objects stored in a database.

This architecture enables:
- **Zero-deployment UI updates**: Modify the design, layout, or logic of the application purely by updating database records.
- **Server-Side Rendering (SSR)**: Preempt builds the initial DOM on the server to deliver fast, SEO-friendly HTML to the client.
- **Hydration & Reactivity**: On the client, Preempt hydrates the pre-rendered HTML, runs a continuous monitoring loop, and seamlessly handles interactive state.

## Core Concepts
1. **Nodes (`NodeData`)**: The foundational building blocks of Preempt. Every element on the page (from a simple `<div>` to a complex application layout) is a Node. Nodes contain properties like `type`, `props`, `content` (children), `css`, and `handlers`.
2. **Templates**: The root structure of a page layout. A Template is simply a large Node tree that establishes the boilerplate layout (headers, sidebars, generic wrappers) and defines drop-zones using *Placements*.
3. **Content**: Page-specific data (like the text of an article or a specific user's dashboard widgets) that is dynamically injected into a Template during the pipeline's assembly phase.
4. **Components**: Reusable fragments of JSON logic (such as a standardized styling preset, an event handler, or a full structural widget like a Login block) that can be merged into any Node on demand.
5. **Handlers**: JavaScript functions attached to Nodes that execute in response to user events (e.g., `click`) or specific lifecycle stages of the rendering pipeline (e.g., `beforeRender`).
6. **Event Streaming**: Preempt leverages an internal event bus (via the `Events` table and a Kafka `eventRelay`) to stream real-time structural payload updates to distributed clients via WebSockets, enabling high-performance, dynamic UI reactivity.

## The Supervisor Pipeline & PhaseRegistry
At the core of Preempt is the **Supervisor**, which orchestrates a 10-stage worker pipeline (Phases 0 through 9) using a suite of decoupled `Worker` classes:

0. **InstantiationWorker** (`'instantiation'`): Converts raw JSON `NodeData` into OOP `Node` instances in memory.
1. **TargetPlacementResolverWorker** (`'targetPlacementResolution'`): Matches nodes with `targetPlacement` requests against available `placementName` drop-zones and assigns `activePlacement`.
2. **PlacementAssemblyWorker** (`'placementAssembly'`): Assembles nodes into `placementName` drop-zones designating that slot as their `activePlacement`.
3. **ComponentRoutingWorker** (`'componentRouting'`): Evaluates target and source component bindings, routing structural updates to Component Assembly or Slot Assembly.
4. **ComponentAssemblyWorker** (`'componentAssembly'`): Applies structural component `layerMap` definitions targeting `"type"` into target hosting nodes.
5. **SlotAssemblyWorker** (`'slotAssembly'`): Applies non-type component `layerMap` definitions (props, styles, handlers, slot contents) into target nodes.
6. **PreprocessingWorker** (`'preprocessing'`): Executes custom preprocessing algorithms and `beforePreprocess`/`afterPreprocess` handlers.
7. **ValidationWorker** (`'validation'`): Automatically triggers lazy `node.compile()` on node state and validates structural integrity before rendering.
8. **SSRElementCreationWorker / ClientElementCreationWorker** (`'elementCreation'`):
   - *Server-Side (`SSRElementCreationWorker`)*: Generates raw HTML opening/closing tag string representations.
   - *Client-Side (`ClientElementCreationWorker`)*: Instantiates native browser `HTMLElement` objects and binds event listeners.
9. **SSRTreeAssemblyWorker / ClientTreeAssemblyWorker** (`'treeAssembly'`):
   - *Server-Side (`SSRTreeAssemblyWorker`)*: Compiles the full virtual DOM tree into a final SSR HTML payload prefixed with dynamic styles.
   - *Client-Side (`ClientTreeAssemblyWorker`)*: Mounts DOM elements into parent containers and applies tree patches.
10. **PostprocessingWorker** (`'postprocessing'`): Executes post-rendering application hooks (`beforePostprocess`, `afterPostprocess`) and cleanup.

### Dynamic Phase Resolution & Worker Emission Rules
- **Dynamic Phase Resolution**: Phase numbers are dynamically resolved via `PhaseRegistry.getPhaseNumber(stageName)`. Emitting events to phases is executed via `Supervisor.emitToPhaseName(caller, node, state, stageName)`. Hardcoding numeric phase literals is prohibited. Use `PhaseRegistry.EMIT_NONE` (`9999`) constant to bypass emissions.
- **Worker Emissions vs `receiveNextState`**: `node.receiveNextState()` is strictly intended for post-processing execution contexts (user event handlers, WebSocket reactivity, and `ClientAPI.modifyNode()`). Workers must **never** call `receiveNextState()`. When `receiveNextState()` runs, it automatically validates against existing assembly worker layers, creates `receiveNextState` layers, and emits to `ValidationWorker`.
- **Anti-Pattern: Direct Node Property Mutation**: Mutating node properties directly (`node.type = ...`, `node.props = ...`) without exposing and using `node.addLayer()` is an unsupported anti-pattern. Node properties are lazy compiled getters.
- **Anti-Pattern: Direct Worker Class Emission**: Calling static `.emitTo()` helper methods directly on `Worker` classes outside of `Supervisor` is an **unsupported Anti-Pattern**. Only `Supervisor` is permitted to manage worker queues and orchestrate node emissions. All pipeline node emissions must strictly be dispatched through `Supervisor.emitToPhase()` or `Supervisor.emitToPhaseName()`.
- **Anti-Pattern Documentation Rule**: Whenever an anti-pattern or unsupported pattern is identified, mentioned, or discussed during development, agents must check `docs/skills/` to verify if it is documented and document it immediately if missing.

### Adding New Workers Without Breaking Changes
When creating or adding new pipeline worker stages, follow these guidelines to prevent breaking changes:
1. **Canonical Stage Definition**: Add the new stage identifier to `PipelineStage` in `src/types/Pipeline.ts`.
2. **Register Phase Mapping**: Register the stage name and its numeric phase ID in `PhaseRegistry.ts` (using `PhaseRegistry.registerWorker(stageName, phaseId)` or adding to registry maps).
3. **Dynamic Phase Assignment in Workers**: Always assign worker phase dynamically: `public readonly phase = PhaseRegistry.getPhaseNumber(stageName);` and update node state with `node.lastCompletedPhase = PhaseRegistry.getPhaseNumber(stageName);`.
4. **Emit via Stage Names**: Forward nodes using `Supervisor.emitToPhaseName(caller, node, targetStageName)` rather than numeric phase arguments (`emitToPhase`).
5. **Update Upstream / Downstream Emissions**: Update the upstream worker's `onProcessSuccess()` to emit to the new stage name, and have the new worker emit to the downstream stage name.
6. **Avoid Hardcoded Phase Literals**: Never hardcode numeric phase IDs in worker logic, Supervisor config, or tests. Dynamic resolution ensures phase order changes or insertions do not break existing pipeline execution.

### Deferred Phase Locking
To support backward chaining when slot assembly (Phase 4) injects new nodes with source components targeting component routing, locking for both `ComponentRoutingWorker` (Phase 2) and `ComponentAssemblyWorker` (Phase 3) is deferred until `SlotAssemblyWorker` (Phase 4) completes/locks.

### Hydration & Reactivity
On the client side, Preempt uses an **atomic node update model** driven by an internal Event Bus, rather than rebuilding the entire virtual DOM tree on every state change.

1. When a handler modifies a node's state (e.g. via `ClientAPI.modifyNode()`), the state payload is pushed to that specific node's `_nextStateQueue`.
2. The `ClientRenderingWorker` listens to the event bus and pulls from these node queues asynchronously.
3. The worker then seamlessly patches the native DOM to reflect the new state, providing granular reactivity without triggering full pipeline re-instantiations (`Supervisor.rerun()`).

## General Use Case
Preempt is designed for highly dynamic platforms where administrators or non-technical operators need the power to restructure layouts, edit styles, and deploy new interactive logic instantly, without requiring a codebase recompilation, pull request, or deployment cycle. 

It acts as a hybrid between a high-performance component framework and a deeply customizable Headless CMS.

## User State and Authentication
Preempt handles user state through a hybrid authentication ecosystem, blending robust local sessions with extensive OAuth/OIDC capabilities.

1. **Multi-Strategy Core**: 
   - **Local JWT Strategy**: Native user/password credentials generate cryptographically signed JWT tokens representing a user's session.
   - **OIDC/OAuth2 Integration**: Preempt seamlessly integrates with compatible identity providers (such as Keycloak) via its dedicated `oauthWorker`. It links external identity claims to local users, mapping credentials and seamlessly migrating external sessions into its native authentication state.

2. **SSR Data Injection**: In the `ssr.ts` route, the `req.user` object is automatically appended to the primary Content Payload. This allows frontend Handlers and Components to access the current user's state directly via `context.metadata.user` or by traversing to the root node's `userData`.

3. **Dynamic Routing**: The root path (`/`) dynamically resolves the content to display. If a logged-in user has a `home_page` preference set in the `Users` table, Preempt will route them to that specific `Content(id)`. Otherwise, it falls back to the server's global `default_index_content_id` setting.

4. **Updating User Preferences**: Users can update their preferences using the `/api/auth/update-home-page` endpoint (requires `POST` with `home_page` containing the target `Content(id)`). This instantly updates the database and issues a new JWT reflecting the updated state.
