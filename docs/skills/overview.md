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

## The Supervisor Pipeline
At the core of Preempt is the **Supervisor**, which orchestrates a multi-stage pipeline using a suite of decoupled `Worker` classes to convert raw JSON data from the database into a fully reactive UI.

1. **InstantiationWorker**: Converts the raw JSON `NodeData` into OOP `Node` instances in memory. During this stage, any Component Bindings with a non-null object or array `value` are eagerly parsed and deeply cloned into an `_instantiatedNodes` array. A cycle-safe `deepClone` (using a `WeakSet` to track references) must be used here to avoid crashing when bindings contain recursive parent/child references.
2. **ComponentAssemblyWorker**: Merges template and content components into the global registry. Resolves standard component references (styles, properties, handlers) by deep-merging them into nodes. For structural components, it merges the eagerly instantiated content/children directly into the target node.
3. **SlotAssemblyWorker**: Assembles dynamically injected content into slots.
4. **PlacementWorker**: The supervisor collects all placements across the tree, deliberately scanning into the `_instantiatedNodes` of structural components to ensure nested drop-zones are mapped correctly. Content nodes are then placed into their target drop-zones.
5. **PreprocessingWorker**: A placeholder stage for implementation-specific expansions (e.g., hooks for custom data formatting).
6. **ValidationWorker**: Executes structural integrity checks to ensure the `Node` tree is valid before rendering.
7. **SSRRenderingWorker / ClientRenderingWorker**:
   - *Server-Side (`SSRRenderingWorker`)*: Generates raw HTML strings and a bundled CSS block to send to the browser.
   - *Client-Side (`ClientRenderingWorker`)*: Syncs the virtual `Node` tree with the native DOM, patching changes iteratively via an atomic event loop.
8. **PostprocessingWorker**: A placeholder stage for final cleanup tasks or custom implementation-specific expansions.

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
