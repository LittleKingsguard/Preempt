import { Supervisor } from './core/Supervisor'
import type { PipelineConfig } from './types/Pipeline'
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
    
    await Supervisor.process(data.template, data.content, pipelineConfig);
    injectEditorDevPanel();
  } catch (err) {
    console.error("Initialization failed:", err);
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<div>Error loading from backend: ${err}</div>`;
  }
}

async function injectEditorDevPanel() {
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
  panel.style.alignItems = 'center';

  const datalist = document.createElement('datalist');
  datalist.id = 'tag-suggestions';
  document.body.appendChild(datalist);

  try {
    const tagsRes = await fetch("http://localhost:3001/api/tags");
    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      tags.forEach((tag: string) => {
        const option = document.createElement('option');
        option.value = tag;
        datalist.appendChild(option);
      });
    }
  } catch (err) {
    console.warn("Could not fetch tags for auto-fill", err);
  }

  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.id = 'template-tags';
  tagsInput.setAttribute('list', 'tag-suggestions');
  tagsInput.placeholder = "Tags (comma separated)";
  tagsInput.style.padding = "5px";

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

    const tagsValue = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);

    try {
      const res = await fetch("http://localhost:3001/api/template/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: exportedData, tags: tagsValue })
      });
      if (res.ok) alert("Template saved successfully!");
      else alert(`Save failed: ${res.status}`);
    } catch(err) {
      alert("Error saving template");
    }
  };

  panel.appendChild(tagsInput);
  panel.appendChild(loginBtn);
  panel.appendChild(saveBtn);
  document.body.appendChild(panel);
}

init();
