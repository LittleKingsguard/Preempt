/**
 * Pipeline execution configuration flags passed to `Supervisor.process()`.
 *
 * @useCase Controls which phases of the 10-worker Supervisor pipeline are executed during a processing run.
 * @processFlow Evaluated by `Supervisor` and workers to determine stage execution and security restrictions (e.g. `isValidationRun` during MCP dry-runs).
 */
export interface PipelineConfig {
  /** Phase 0: Instantiates raw JSON into OOP Node instances. */
  runInstantiation: boolean;
  /** Phases 1-4: Resolves placement drop-zones, component routing, component assembly, and slot assemblies. */
  runAssembly: boolean;
  /** Phase 5: Executes custom preprocessing logic algorithms. */
  runPreprocessing: boolean;
  /** Phase 6: Executes structural schema and required property validation checks. */
  runValidation: boolean;
  /** Phases 7-8: Generates HTML string (SSR) or constructs/patches browser DOM elements. */
  runRendering: boolean;
  /** Phase 9: Executes post-rendering application hooks and cleanup. */
  runPostprocessing: boolean;
  /** Client monitoring flag for interactive reactive loop. */
  runMonitoring: boolean;
  /** Security flag set during MCP validation dry-runs to disable arbitrary code evaluation. */
  isValidationRun?: boolean;
}

export type PipelineStage = 
  | 'instantiation' 
  | 'targetPlacementResolution'
  | 'placementAssembly'
  | 'componentRouting'
  | 'componentAssembly' 
  | 'slotAssembly' 
  | 'preprocessing' 
  | 'validation' 
  | 'elementCreation' 
  | 'treeAssembly' 
  | 'postprocessing';

export interface PipelineContext {
  mountElementId?: string;
  stage: PipelineStage | string;
  hasInstantiated: boolean;
  userData?: any;
}

import type { Node } from "../core/Node.js";

export interface PipelineObserver {
  onStageStart?: (stage: PipelineStage, context: PipelineContext) => void;
  onStageComplete?: (stage: PipelineStage, rootNode: Node | null, context: PipelineContext) => void;
  onError?: (stage: PipelineStage, error: Error, context: PipelineContext) => void;
}
