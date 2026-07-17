const fs = require('fs');
const path = require('path');

const workers = [
  { name: 'PlacementWorker.ts', next: 2 },
  { name: 'ComponentAssemblyWorker.ts', next: 3 },
  { name: 'SlotAssemblyWorker.ts', next: 4 },
  { name: 'PreprocessingWorker.ts', next: 5 },
  { name: 'ValidationWorker.ts', next: 7 },
  { name: 'PostprocessingWorker.ts', next: -1 } // no emit
];

const dir = 'src/core/workers';

workers.forEach(w => {
  const filePath = path.join(dir, w.name);
  let content = fs.readFileSync(filePath, 'utf8');
  
  let emitCode = "";
  if (w.next !== -1) {
    emitCode = `    if (typeof (globalThis as any).Supervisor !== 'undefined' && typeof (globalThis as any).Supervisor.emitToPhase === 'function') {
      (globalThis as any).Supervisor.emitToPhase(_node, _rollbackState || {}, ${w.next});
    }`;
  }

  // Replace the empty onProcessSuccess block
  const oldRegex = /protected onProcessSuccess\(_node: Node, _rollbackState\?: RollbackState\): void {\s*(\/\/.*)?\s*}/m;
  
  if (oldRegex.test(content)) {
    content = content.replace(oldRegex, `protected onProcessSuccess(_node: Node, _rollbackState?: RollbackState): void {\n${emitCode}\n  }`);
    fs.writeFileSync(filePath, content);
    console.log(`Patched ${w.name}`);
  } else {
    console.log(`Could not patch ${w.name} (regex didn't match)`);
  }
});
