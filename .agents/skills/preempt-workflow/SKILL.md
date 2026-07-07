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

## Accessing Advanced Documentation
Detailed technical guidelines exist in the repository under `docs/skills/`. Before making major structural or design changes, you should read the relevant file using the `view_file` tool:
- `docs/skills/overview.md`: Core architecture, Supervisor pipeline, and User Auth state.
- `docs/skills/handlers.md`: Advanced handlers, traversal (`findNode`), and state management.
- `docs/skills/components.md`: Component JSON bindings, targets, and references.
- `docs/skills/styles.md`: Dynamic CSS pipeline and programmatic modification.
- `docs/skills/templates.md`: Layout layouts, default wrappers, and drop-zones.
- `docs/skills/placements.md`: Logic for injecting content into template wrappers.
- `docs/skills/testing.md`: Playwright testing standards for this framework.
