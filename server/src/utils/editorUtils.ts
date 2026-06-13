import { pool } from "../db.js";
import { queryFirstRow } from "./db.js";

export async function checkHasEditorTag(templateId: number): Promise<boolean> {
  const tagCheck = await queryFirstRow(`
    SELECT 1 FROM TemplateTags tt
    JOIN Tags tag ON tt.tag_id = tag.id
    JOIN Templates t ON tt.template_id = t.id
    JOIN Templates rt ON t.group_id = rt.group_id
    WHERE rt.id = $1 AND tag.name = 'editor'
  `, [templateId]);
  return !!tagCheck;
}

export async function injectEditorDependencies(targetPayload: any, templatePayload: any | null, editorMode: string, hasEditorTag: boolean): Promise<void> {
  // NOTE: This function does not perform circular reference/recursion checks on the node payload structures.
  // The layout data processed here is always loaded from JSON stored in the database, which strictly prevents circular/recursive references.
  const injectInspectHandlers = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.component && node.component.some((c: any) => c.reference === "PreemptEditor")) return;
    
    const hasClickHandler = node.handlers?.click || node.handlers?.onclick;
    const hasComponentClickHandler = node.component?.some((c: any) => c.target === "handlers.click" || c.target === "handlers.onclick");
    
    if (!hasClickHandler && !hasComponentClickHandler) {
      if (!node.component) node.component = [];
      node.component.push({ reference: "EditorInspectHandler", target: "handlers.click" });
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(injectInspectHandlers);
    } else if (typeof node.content === 'object') {
      injectInspectHandlers(node.content);
    }
  };

  if (templatePayload?.content) {
    if (Array.isArray(templatePayload.content)) {
      templatePayload.content.forEach(injectInspectHandlers);
    } else {
      injectInspectHandlers(templatePayload.content);
    }
  }
  
  if (targetPayload?.content && targetPayload !== templatePayload) {
    if (Array.isArray(targetPayload.content)) {
      targetPayload.content.forEach(injectInspectHandlers);
    } else {
      injectInspectHandlers(targetPayload.content);
    }
  }

  // Editor tag checks and injections are handled directly in content.ts now
}
