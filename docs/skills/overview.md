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

## The Supervisor Pipeline
At the core of Preempt is the **Supervisor**, which orchestrates a multi-stage pipeline to convert raw JSON data from the database into a fully reactive UI. 

The pipeline executes the following stages sequentially:
1. **DB Load**: Fetches the Template, Content, Handlers, and Components from the SQL database. (SSR only)
2. **Instantiation**: Converts the raw JSON `NodeData` into OOP `Node` instances in memory.
3. **Assembly**: Resolves component references (deep-merging them into nodes) and places Content nodes into their respective target drop-zones within the Template.
4. **Pre-Processing & Validation**: Hooks for custom data formatting and structural integrity checks.
5. **Rendering**:
   - *Server-Side*: Generates raw HTML strings and a bundled CSS block to send to the browser.
   - *Client-Side*: Syncs the virtual `Node` tree with the native DOM, patching changes iteratively.
6. **Post-Processing**: Final cleanup tasks.
7. **Monitoring**: (Client-Side only) Enters a continuous loop that checks the `Node` tree for state mutations. If a node changes (e.g., a handler modifies its style or content), Preempt automatically flushes that specific node's updates to the DOM.

## General Use Case
Preempt is designed for highly dynamic platforms where administrators or non-technical operators need the power to restructure layouts, edit styles, and deploy new interactive logic instantly, without requiring a codebase recompilation, pull request, or deployment cycle. 

It acts as a hybrid between a high-performance component framework and a deeply customizable Headless CMS.

## User State and Authentication
Preempt handles user state through a JWT-based authentication system. When a user is authenticated, their session data (including roles, verification status, and preferences like `home_page`) is injected into the frontend during the Server-Side Rendering (SSR) phase.

1. **SSR Data Injection**: In the `ssr.ts` route, the `req.user` object is automatically appended to the root Content Node payload at `contentData.payload.userData` and `contentData.payload.metadata.user`. This allows frontend Handlers and Components to access the current user's state directly from the virtual DOM tree.
2. **Dynamic Routing**: The root path (`/`) dynamically resolves the content to display. If a logged-in user has a `home_page` preference set in the `Users` table, Preempt will route them to that specific `Content(id)`. Otherwise, it falls back to the server's global `default_index_content_id` setting.
3. **Updating User Preferences**: Users can update their preferences using the `/api/auth/update-home-page` endpoint (requires `POST` with `home_page` containing the target `Content(id)`). This instantly updates the database and issues a new JWT reflecting the updated state.
