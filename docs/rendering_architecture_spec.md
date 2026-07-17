# Preempt Frontend Rendering Architecture Specification

This document outlines the technical specification for Preempt's Object-Oriented, Atomic Message-Passing rendering architecture. It serves as a reference for agents and developers modifying the codebase.

## Overview
The architecture is designed to prevent data loss, stale state, and instantiation issues by treating rendering updates as asynchronous, atomic messages handled by specialized event Workers. The system replaces monolithic top-down tree iterations with decentralized node queues.

## Core Principles
1. **Atomic Updates (`NextState`)**: Nodes update their state individually via immutable `NextState` payloads instead of relying on a global pipeline to dictate their changes.
2. **Decentralized Processing**: Heavy lifting (DOM calculation, deep tree manipulations) is stripped from `Node` and `Supervisor` classes and placed into isolated `Workers`.
3. **Phase Locking**: A strict priority locking mechanism prevents recursive loops and guarantees phase structural integrity.
4. **Data Integrity & Rollback**: Node states protect against unintended referential mutations. Nodes always hold a valid rollback state.

---

## 1. Phase Definition & Locking Map
The system uses qualifiers for each step based on the `PipelineConfig` schema. Not all steps lock data; some only trigger node-level handler calls.

| Phase ID | Pipeline Step | Action / Locked Property | Rules & Cascading Behavior |
| :--- | :--- | :--- | :--- |
| **0** | `runInstantiation` | Locks `Node.data` | **Accepts raw NodeData to construct new Node instances**, or applies NextState to existing nodes. Updates global placement data so other nodes can identify them. **Supervisor placement arrays (`Node.placementArray`, `Node.sourcePlacements`) are locked globally after this phase.** |
| **1** | `runAssembly` (Placement) | Locks `placement` data | **Cascade**: If placement is removed, update `Node.placementArray` immediately, push update requests to referencing nodes. If added, update array, check `Node.sourcePlacements` and push update requests to targeters. |
| **2** | `runAssembly` (Component) | Locks `type` components | **Cascade**: Whenever a component is changed, calculate and push `NextState` for all referencing nodes. |
| **3** | `runAssembly` (Slot) | Locks all other components | Standard lock. |
| **4** | `runPreprocessing` | None (Triggers handlers) | Node autonomously fires `beforePreprocess`/`afterPreprocess`. |
| **5** | `runValidation` | Locks all other data (props, css) | Validation verification. |
| **6** | `runRendering` | None (Output) | DOM/SSR output generated. |
| **7** | `runPostprocessing`| None (Triggers handlers) | Node autonomously fires `beforePostprocess`/`afterPostprocess`. |

> **Lock Resets**: Phase locks for a node are cleared when the rendering or post-processing phase finishes and the Supervisor enters either a `closed` or `monitoring` state.

---

## 2. Worker Layer Specification
To lighten the core `Node` and `Supervisor` classes, processing logic is extracted into dedicated Worker modules (e.g., `InstantiationWorker`, `PlacementWorker`, `ComponentAssemblyWorker`, `ValidationWorker`).

* **Dual-Mode Instantiation**: The `InstantiationWorker` uniquely accepts raw `NodeData` objects (e.g. freshly fetched component payloads) to dynamically construct new `Node` instances from scratch, in addition to processing `NextState` updates on existing Nodes.
* **Isolated Event Stacks (Map-Based)**: Each Worker maintains its own event queue structured as a `Map<Node, RollbackState>` rather than a standard array. The Supervisor does not hold a monolithic queue.
* **Deduplication & Rollback Preservation**: Because `NextState` is applied optimistically by the Node, the queue stores the state needed to revert rather than pending changes. If an event pushes a node already in the Map, the Worker preserves the original `RollbackState`. This efficiently batches rapid cascading updates by letting the Node accumulate optimistic changes, while ensuring a safe rollback to the pre-batch state if necessary.
* **Autonomous Processing**: Workers independently pop events off their specific Maps. Because the Node has *already* immediately applied the `NextState` (and successfully diffed against locks), the Worker treats the current state as valid. The Worker's role is to handle any structural side effects or cascading updates, verify logic specific to the phase, and then emit the resulting event to the next phase queue (or trigger a rollback if processing fails).
* **Node-Level Handler Processing**: Workers directly instruct the Node to invoke its phase-related handlers as part of processing that specific phase's stack.

---

## 3. Data Integrity & Rollback Rules
To prevent asynchronous anomalies and state contamination, the following strict data handling rules apply:

* **Assign-by-Reference Prevention**: Properties (e.g., `props`, `css`, `component` arrays, `handlers`) processed from a `NextState` object must be protected from assign-by-reference mutations.
* **No Node Deep-Cloning**: To avoid excess duplication, the system will explicitly **skip deep-cloning of child nodes**. 
* **Builder Responsibility**: When deep-cloning *is* applicable (e.g., type component injection), the burden of responsibility is placed entirely on the function building the `NextState`.
* **Immediate State Application & Rollback Backup**: 
  * When a node receives a `NextState`, it applies the data to its active state. To external references, it behaves as though `NextState` is its fully current state. 
  * The node simultaneously stores a shallow copy/reference of its **last known valid state** (`this._lastValidState`) without traversing child nodes.
* **Failure Recovery**: If a worker fails to process the node, the node catches the error, logs it, and triggers a rollback, restoring its properties from `this._lastValidState`.
* **Global Stale Data Cleanup**: Whenever a node is removed or replaced, it must actively unregister itself from static global tracking arrays (`Node.placementArray`, `Node.sourcePlacements`, `Node.typeComponentNodes`) and clean up bindings in `Node.globalMetadata`.

---

## 4. Architectural Roles

### Supervisor (`src/core/Supervisor.ts`)
* **Role**: Pure Orchestrator / Central Bus.
* **Responsibilities**:
  * Registers Workers and routes cross-phase events.
  * Ensures global placement arrays are locked after Instantiation.
  * **SSR Alignment**: Waits until all pre-render Worker event stacks have completely drained before executing `renderToString`.
  * Triggers state reset when entering `closed` or `monitoring` mode.
  * Retains `rerun` pipeline functionality *only* as a fallback method for unrecoverable errors.
* **Anti-Patterns**: Should not iterate the node tree directly to trigger handlers. Should not process heavy structural assembly.

### Node (`src/core/Node.ts`)
* **Role**: Pure State Container / Event Emitter.
* **Responsibilities**:
  * Dynamic Root Instantiation (compiling data without aggressive array clearing).
  * Method `receiveNextState(NextState)`: 
    * First, diffs the `NextState` against the phase locks. If it attempts to modify a property for a phase that is already locked in the current cycle, the node denies the change, prevents the update, and logs an error.
    * If the diff passes, it applies the state optimistically, stores a rollback copy, determines the required phase qualifier, and pushes the payload to the appropriate Worker.
* **Anti-Patterns**: Should not perform tree traversal logic, component merging, or extensive DOM manipulation.

### Client API (`src/core/ClientAPI.ts`)
* **Role**: Interface for external interactions and programmatic state updates.
* **Responsibilities**:
  * `modifyNode`: Constructs a `NextState` object and passes it to the target node (which routes it to the relevant Worker's queue).
  * `fetchContent`: Loads remote data and submits `NextState` requests for structural changes.
* **Anti-Patterns**: Should not directly mutate properties on target nodes. Should not call `Supervisor.rerun()` directly for standard updates.
