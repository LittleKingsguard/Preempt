import { Supervisor } from './core/Supervisor'
import type { PipelineConfig } from './types/Pipeline'
const config: PipelineConfig = {
  runInstantiation: true,
  runAssembly: true, 
  runPreprocessing: true, 
  runValidation: true, 
  runRendering: true,
  runPostprocessing: true, 
  runMonitoring: true 
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>Loading Supervisor from Backend...</div>
`

async function init() {
  try {
    const res = await fetch("http://localhost:3001/api/content/1");
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    
    await Supervisor.process(data.template, data.content, config);
  } catch (err) {
    console.error("Initialization failed:", err);
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<div>Error loading from backend: ${err}</div>`;
  }
}

init();
