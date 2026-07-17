const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('/home/ryan/.gemini/antigravity-ide/brain/8b8aa7b5-9cfe-4d71-aefe-604083cd7b53/.system_generated/logs/transcript.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lastNodeEdit = null;

  for await (const line of rl) {
    if (line.includes('multi_replace_file_content') && line.includes('src/core/Node.ts')) {
      const parsed = JSON.parse(line);
      lastNodeEdit = parsed;
    }
  }

  if (lastNodeEdit) {
    fs.writeFileSync('node_edit.json', JSON.stringify(lastNodeEdit, null, 2));
    console.log('Saved to node_edit.json');
  } else {
    console.log('Not found');
  }
}
processLineByLine();
