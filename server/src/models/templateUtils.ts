import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function resolveEditorTemplateId(baseId: number, editorMode: string | null): Promise<number> {
  if (!editorMode) return baseId;
  const editorTagCheck = await queryFirstRow(`
    SELECT t.id FROM TemplateTags tt
    JOIN Tags tag ON tt.tag_id = tag.id
    JOIN Templates t ON tt.template_id = t.id
    JOIN Templates rt ON t.group_id = rt.group_id
    WHERE rt.id = $1 AND tag.name = 'editor'
    LIMIT 1
  `, [baseId]);
  
  return editorTagCheck ? editorTagCheck.id : baseId;
}

export async function fetchTemplateRecord(templateId: number): Promise<any> {
  return await queryFirstRow("SELECT * FROM Templates WHERE id = $1", [templateId]);
}

export async function fetchTemplateHandlers(templateId: number) {
  const handlerResult = await pool.query(`
    SELECT h.name, h.body 
    FROM Handlers h
    JOIN TemplateHandlers th ON h.id = th.handler_id
    WHERE th.template_id = $1
    UNION
    SELECT h.name, h.body
    FROM Handlers h
    JOIN ComponentHandlers ch ON h.id = ch.handler_id
    JOIN TemplateComponents tc ON ch.component_id = tc.component_id
    WHERE tc.template_id = $1
  `, [templateId]);
  return handlerResult.rows;
}

export async function populateTemplateHandlers(payload: any, templateId: number): Promise<void> {
  const handlerRows = await fetchTemplateHandlers(templateId);

  if (handlerRows.length > 0) {
    if (!payload.component) payload.component = [];
    handlerRows.forEach((h: any) => {
      payload.component.push({
        reference: h.name,
        value: h.body
      });
    });
  }
}

export async function fetchTemplateComponents(templateId: number) {
  const componentResult = await pool.query(`
    SELECT c.name, c.payload 
    FROM Components c
    JOIN TemplateComponents tc ON c.id = tc.component_id
    WHERE tc.template_id = $1
  `, [templateId]);
  return componentResult.rows;
}

export async function populateTemplateComponents(payload: any, templateId: number): Promise<void> {
  const componentRows = await fetchTemplateComponents(templateId);

  if (componentRows.length > 0) {
    if (!payload.component) payload.component = [];
    componentRows.forEach((c: any) => {
      payload.component.push({
        reference: c.name,
        value: c.payload
      });
    });
  }
}
