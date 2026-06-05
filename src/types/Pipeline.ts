export interface PipelineConfig {
  runInstantiation: boolean;
  runAssembly: boolean;
  runPreprocessing: boolean;
  runValidation: boolean;
  runRendering: boolean;
  runPostprocessing: boolean;
  runMonitoring: boolean;
  isValidationRun?: boolean;
}
