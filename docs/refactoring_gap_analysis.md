# Refactoring Gap Analysis: Atomic Message-Passing Architecture

This document outlines the remaining gaps between the current Preempt codebase (`src/core/*`) and the Atomic Message-Passing Architecture specified in `docs/rendering_architecture_spec.md`.

## 1. Node Class (`src/core/Node.ts`)
The `Node` class has received significant updates and implements much of the required spec, including `receiveNextState` and shallow-copy rollback preservation (`_lastValidState`). However, it has several critical gaps:

*   **Blind Trust of Phase IDs in `receiveNextState`**: Currently, `receiveNextState` requires and blindly trusts a passed `phaseId` parameter. It needs to be refactored to dynamically diff the incoming `NextState` against the current state to determine exactly what data is changing.
*   **Decentralized Lock Logic**: The Node currently tries to manage its own `_lockedPhases` set. It must be updated to query the Supervisor (the new central authority) to determine if the specific properties it detected as changing during the diff violate any currently locked phases.
*   **Missing Routing Method**: Inside `receiveNextState`, the Node attempts to route its update by calling `Supervisor.getWorkerForPhase()`, but this method doesn't exist on the Supervisor.

## 2. Supervisor Class (`src/core/Supervisor.ts`)
The `Supervisor` still largely acts as a sequential loop processor rather than a pure event-driven orchestrator, and it lacks central authority over phase data.

*   **Centralized Phase & Lock Data**: The Supervisor must be updated to store the definitions of phase data (which data properties map to which phases) and the current lock states centrally. It must expose a query interface for `Node` to check if a specific data mutation violates active locks.
*   **Missing `getWorkerForPhase()`**: The Supervisor must implement this routing method to allow `Node.ts` to push its `NextState` changes to the appropriate Worker.
*   **Sequential Pipeline Over-Reliance**: `runPipeline()` is still heavily hardcoded to iterate through phases sequentially (`this.instantiate()`, `this.assemble()`, etc.) instead of simply ensuring all worker Map queues are completely drained before proceeding to the `renderToString` step.
*   **Phase Lock Leakage**: The Supervisor does not actively manage and clear the central phase locks when it enters a `closed` or `monitoring` state. This will cause subsequent `NextState` updates to be permanently locked out.
*   **`rerun()` Abuse**: The `rerun()` method is still being used as the primary way to trigger updates (calling `resetInstantiation()` and wiping the system), rather than being reserved strictly as a fallback for unrecoverable errors.

## 3. Client API (`src/core/ClientAPI.ts`)
While `modifyNode` correctly delegates to `receiveNextState`, the data-fetching side of the API remains tied to the old monolithic pipeline.

*   **`fetchContent` and `addContentNodes` trigger `Supervisor.rerun()`**: When external content is fetched (like in Edit Mode), these methods push the payload to the Supervisor's arrays and directly invoke `await Supervisor.rerun();`. This triggers a massive global wipe/re-render. They should instead parse the payload and leverage the dual-mode `InstantiationWorker` (via `pushRaw`) or directly apply `NextState` to let the decentralized worker queues handle the DOM injection organically.

## 4. Worker Implementations (`src/core/workers/*`)
The workers have been structurally transitioned to extend `BaseWorker` and utilize Map-based queues (`Map<Node, RollbackState>`). However, their processing logic needs verification against the spec's strict cascading requirements.

*   **Cascading Updates in `ComponentAssemblyWorker`**: It must be verified that when a master component is modified, the worker explicitly calculates and pushes `NextState` updates to all referencing instances (feedback loop).
*   **Error Catching & Rollbacks**: Workers must ensure they properly trigger `node.rollback(rollbackState)` if a structural error occurs during `processNode()`.

## Summary of Next Steps
1.  **Supervisor**: Implement `getWorkerForPhase`, add phase lock clearing on completion, and remove the dependency on `rerun()`.
2.  **ClientAPI**: Refactor `fetchContent` to use atomic NextState/Instantiation queues rather than `Supervisor.rerun()`.
3.  **Workers**: Verify cascading feedback loops are correctly firing `receiveNextState` on referencing nodes.
