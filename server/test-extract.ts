function extractReferences(payload: any): { components: string[], handlers: string[] } {
  const components = new Set<string>();
  const handlers = new Set<string>();

  const traverse = (node: any) => {
    if (!node) return;
    if (node.component && Array.isArray(node.component)) {
      for (const comp of node.component) {
        if (comp.reference) {
          if (comp.target && comp.target.startsWith('handlers.')) {
            handlers.add(comp.reference);
          } else {
            components.add(comp.reference);
          }
        }
      }
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  };

  traverse(payload);

  return { components: Array.from(components), handlers: Array.from(handlers) };
}
import fs from 'fs';
const payload = JSON.parse(fs.readFileSync('library/templates/navSidebar/desktop_dynamic.json', 'utf8'));
console.log(extractReferences(payload));
