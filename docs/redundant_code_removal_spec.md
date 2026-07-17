# Redundant Code Removal & Required Methods Spec

This document outlines the required methods for the `Node` and `Supervisor` classes under the new centralized orchestration architecture, and identifies redundant code that should be removed to align with the new spec while preserving test stability.

## Required Methods

### `Supervisor` (The Central Orchestrator)
The `Supervisor` acts as the single source of truth for pipeline execution and phase tracking.
*   **Pipeline Management**: `process(config, templateData, contentData)`, `rerun(config)`, `close()`, `monitor()`, `pauseMonitoring()`, `resumeMonitoring()`.
*   **Central Phase Locking**: `isPhaseLocked(phaseId: number): boolean`, `isPropertyLocked(propertyName: string): boolean`.
*   **Data Injection**: `injectContent(payload)` - must handle batch ID replacement and structural node rebuilding natively.
*   **State Access**: `getRootNode(): Node | null`, `getContentNodes(): Node[]`, `exportRootNode(): NodeData | null`.
*   **Priority Loop Execution**: Must contain the 0-7 phase draining loop within `runPipeline()`, skipping phase 6 (rendering) to handle it separately based on environment.

### `Node` (The Data Primitive)
The `Node` acts as a pure, reactive data container without rendering or orchestration side effects.
*   **Core State Updates**: `receiveNextState(nextState, explicitPhaseId?)` - queries the Supervisor centrally before applying state diffs.
*   **Safety & Rollback**: `rollback(state?)` - restores the `_lastValidState` snapshot.
*   **Event Handling**: `executeHandlers(phase, context)` - **MUST** dynamically wrap script evaluations in isolated `try/catch` blocks to prevent bubbling crashes.
*   **Validation & Querying**: `validate(bubbleErrors?)`, `isMatch(query)`, `findNodes(query)`, `findNode(query)`.

---

## Redundant Code Identified for Removal

### 1. `RenderingWorker.ts` (Complete File)
*   **Why**: The monolithic rendering worker is being deprecated entirely in favor of an environment-split architecture.
*   **Removal Process**: Delete `src/core/workers/RenderingWorker.ts`.
*   **Integration Replacement**: 
    *   Initialize `ClientRenderingWorker` if running in a browser environment (mutating `HTMLElement`).
    *   Initialize `SSRRenderingWorker` if running on the server (returning HTML strings).
    *   Update `Supervisor.ts` to branch between these two in `runPipeline()` / `render()` instead of defaulting to the old worker.

### 2. Component Assembly Logic in `Node.ts` (`applyComponentsTree` & `applyComponents`)
*   **Why**: The architecture dictates that `Node` should act strictly as a reactive data primitive. Heavy structural traversal, component resolution, and tree mutation are orchestration responsibilities.
*   **Removal Process**: 
    *   Completely remove `applyComponentsTree` and `applyComponents` from `Node.ts`.
    *   Migrate the core resolution logic to the `ComponentAssemblyWorker`. The worker will calculate the new properties/children based on component bindings and push the flat changes to the Node via `receiveNextState(diff)`.
    *   This naturally solves the deep-cloning constraint, as the AssemblyWorker (acting on payloads) will manage the object lifecycles prior to pushing state updates to the Node.

### 3. Static Singleton Phase Locks in `Supervisor.ts`
*   **Why**: `Supervisor.ts` currently defines `public static activeLockedPhases = new Set();`. A Supervisor should be capable of running isolated instances (e.g., in edge workers). Global statics violate isolation.
*   **Removal Process**:
    *   Move `activeLockedPhases` and `isPropertyLocked` to instance-level properties/methods.
    *   Update `Node.ts` inside `receiveNextState` to query `Supervisor.instance.isPropertyLocked` (or pass the instance via context) rather than calling the static class.

### 4. Legacy `renderToString` Artifacts
*   **Why**: Nodes should not render themselves. 
*   **Removal Process**: Ensure `Node.ts` and `StyleNode.ts` are entirely stripped of string manipulation related to DOM serialization. All string-building logic must strictly reside in `SSRRenderingWorker`. (Note: `Node.ts` already appears largely clear of this, but `StyleNode.ts` needs auditing).
