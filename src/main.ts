import { Supervisor } from './core/Supervisor'
import type { PipelineConfig } from './types/Pipeline'
import mockData from './mockData.json'

const config: PipelineConfig = {
  runInstantiation: true,
  runAssembly: false, 
  runPreprocessing: true, 
  runValidation: true, 
  runRendering: true,
  runPostprocessing: true, 
  runMonitoring: true 
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>Loading Supervisor...</div>
`

Supervisor.process(mockData as any, config).catch(console.error);
