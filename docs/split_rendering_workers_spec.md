# Spec: Separated Rendering Workers (Client vs. SSR)

## Overview
Currently, the `RenderingWorker` is a hybrid class responsible for both mutating the live browser DOM (`render`) and generating static HTML strings for server-side environments (`renderToString`). 

To adhere strictly to the Single Responsibility Principle and optimize bundle sizes, this architecture will separate rendering into two distinct workers: `ClientRenderingWorker` and `SSRRenderingWorker`.

## 1. ClientRenderingWorker
**Path:** `src/core/workers/ClientRenderingWorker.ts`

**Purpose:** Purely manages the live browser DOM. It traverses the `Node` object tree and creates, updates, or deletes real `HTMLElement` instances.

**Execution Context:**
- Only executes if `typeof document !== 'undefined'`.
- Skips execution silently in NodeJS/SSR environments.

**Responsibilities:**
- **Element Lifecycle:** Creates new `HTMLElement`s (`document.createElement`), reuses existing elements when tags match, and cleans up old elements (`el.remove()`).
- **State Synchronization:** Reads `props`, `css`, and `content` from the `Node` and applies them to the DOM element (`setAttribute`, `classList.add`, `el.style`, `textContent`).
- **Event Hydration:** Parses and attaches `EventListener` functions to the element based on the `Node.handlers` definitions. Cleans up old listeners on re-renders.
- **Tree Reconciliation:** Ensures the physical DOM tree structure strictly mirrors the virtual `Node.children` structure via `appendChild` and `replaceWith`.
- **Hooks:** Executes `beforeRender` and `afterRender` node handlers.

**Worker Pipeline Behavior:**
Operates on a continuous event queue. When a node's `NextState` implies a visual change, it enters this worker's queue and is eventually flushed to the DOM.

---

## 2. SSRRenderingWorker
**Path:** `src/core/workers/SSRRenderingWorker.ts`

**Purpose:** Purely generates a finalized HTML string from a valid, fully resolved `Node` tree. It expects a top-level root node and synchronously builds the HTML output for it and all descendants.

**Execution Context:**
- Primarily used in NodeJS/Deno environments when building static assets or serving requests.

**Responsibilities:**
- **Tree Traversal:** Recursively steps through the root node and all `children`.
- **String Building:** Constructs raw HTML tags (e.g., `<div class="x">...</div>`).
- **Sanitization:** Escapes quotes and sensitive characters in attributes to prevent injection (e.g., converting `"` to `&quot;`).
- **Handler Serialization:** Serializes JavaScript function strings in `Node.handlers` so they exist as inline JS in the generated HTML.
- **Void Elements:** Strictly respects HTML5 void elements (e.g., `<img>`, `<input>`) by ensuring they are self-closing and do not receive innerHTML.

**Worker Pipeline Behavior:**
Unlike the client worker, the SSR worker is generally a **single-pass** execution. The `Supervisor` ensures all other pre-render queues (Instantiation, Placement, Validation) are completely empty. Once the graph is perfectly stable, the `SSRRenderingWorker` is given the root node to convert the entire graph into a string payload in one shot.
