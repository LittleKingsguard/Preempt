import { Supervisor } from './core/Supervisor'
import type { PipelineConfig } from './types/Pipeline'

(window as any).Preempt = { Supervisor };
const defaultConfig: PipelineConfig = {
  runInstantiation: true,
  runAssembly: true, 
  runPreprocessing: true, 
  runValidation: true, 
  runRendering: true,
  runPostprocessing: true, 
  runMonitoring: true 
};

async function init() {
  try {
    const dataElement = document.getElementById('preempt-initial-data');
    let data;
    let pipelineConfig = { ...defaultConfig };

    if (dataElement) {
      data = JSON.parse(dataElement.textContent || "{}");
      if (data.clientConfig) {
        pipelineConfig = { ...pipelineConfig, ...data.clientConfig };
      }
    } else {
      document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
        <div>Loading Supervisor from Backend...</div>
      `;
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const tagsQuery = prefersDark ? '?tags=dark-mode' : '';
      const res = await fetch(`http://localhost:3001/api/content/1${tagsQuery}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      data = await res.json();
    }
    (window as any).Preempt.templateData = data.template;
    (window as any).Preempt.contentData = data.content;
    (window as any).Preempt.pipelineConfig = pipelineConfig;
    
    await Supervisor.process(data.template, data.content, pipelineConfig);
  } catch (err) {
    console.error("Initialization failed:", err);
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<div>Error loading from backend: ${err}</div>`;
  }
}

init();
