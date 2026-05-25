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
    injectEditorDevPanel();
  } catch (err) {
    console.error("Initialization failed:", err);
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<div>Error loading from backend: ${err}</div>`;
  }
}

function injectEditorDevPanel() {
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.bottom = '10px';
  panel.style.right = '10px';
  panel.style.background = '#222';
  panel.style.padding = '10px';
  panel.style.border = '1px solid #444';
  panel.style.borderRadius = '5px';
  panel.style.display = 'flex';
  panel.style.gap = '10px';

  const loginBtn = document.createElement('button');
  loginBtn.textContent = "Login (Admin)";
  loginBtn.onclick = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password123" })
      });
      if (res.ok) alert("Logged in successfully!");
      else alert("Login failed");
    } catch(err) {
      alert("Error logging in");
    }
  };

  const saveBtn = document.createElement('button');
  saveBtn.textContent = "Save Template";
  saveBtn.onclick = async () => {
    const exportedData = Supervisor.exportRootNode();
    if (!exportedData) return alert("Nothing to save");

    try {
      const res = await fetch("http://localhost:3001/api/template/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: exportedData })
      });
      if (res.ok) alert("Template saved successfully!");
      else alert(`Save failed: ${res.status}`);
    } catch(err) {
      alert("Error saving template");
    }
  };

  panel.appendChild(loginBtn);
  panel.appendChild(saveBtn);
  document.body.appendChild(panel);
}

init();
