import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

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

  if (!hasEditorTag) {
    const basePayload = templatePayload || targetPayload;
    if (!basePayload.content) basePayload.content = [];
    if (!Array.isArray(basePayload.content)) {
      basePayload.content = [basePayload.content];
    }
    basePayload.content.push({
      type: "div",
      component: [
        { reference: "PreemptEditor", target: "type" },
        { reference: "editorMode", target: "props.mode", value: editorMode }
      ]
    });

    const editorComponent = await queryFirstRow(`SELECT payload FROM Components WHERE name = 'PreemptEditor'`);
    if (editorComponent) {
      if (!targetPayload.component) targetPayload.component = [];
      targetPayload.component.push({
        reference: "PreemptEditor",
        value: editorComponent.payload
      });
    }

    const editorHandlersRes = await pool.query(`
      SELECT h.name, h.body FROM Handlers h
      JOIN ComponentHandlers ch ON h.id = ch.handler_id
      JOIN Components c ON ch.component_id = c.id
      WHERE c.name = 'PreemptEditor'
    `);
    editorHandlersRes.rows.forEach((h: any) => {
      targetPayload.component.push({
        reference: h.name,
        value: h.body
      });
    });
  }
}
