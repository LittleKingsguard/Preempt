import { pool } from "../db.js";
import { queryFirstRow } from "./db.js";
import { validateUserRoles } from "../middleware/auth.js";

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
  return await queryFirstRow("SELECT * FROM Templates WHERE id = $1", [templateId], "Template not found");
}

export async function fetchTemplateHandlers(templateId: number) {
  const handlerResult = await pool.query(`
    SELECT h.name, h.body, h.approved_roles, h.author_id 
    FROM Handlers h
    JOIN TemplateHandlers th ON h.id = th.handler_id
    WHERE th.template_id = $1
    UNION
    SELECT h.name, h.body, h.approved_roles, h.author_id
    FROM Handlers h
    JOIN ComponentHandlers ch ON h.id = ch.handler_id
    JOIN TemplateComponents tc ON ch.component_id = tc.component_id
    WHERE tc.template_id = $1
  `, [templateId]);
  return handlerResult.rows;
}

export async function populateTemplateHandlers(payload: any, templateId: number, user: any): Promise<void> {
  const handlerRows = await fetchTemplateHandlers(templateId);

  if (handlerRows.length > 0) {
    if (!payload.component) payload.component = [];
    handlerRows.forEach((h: any) => {
      if (!validateUserRoles(user, h.approved_roles || [], h.author_id)) {
        payload.component.push({
          reference: h.name,
          value: h.body
        });
      }
    });
  }
}

export async function fetchTemplateComponents(templateId: number) {
  const componentResult = await pool.query(`
    SELECT c.name, c.payload, c.approved_roles, c.author_id 
    FROM Components c
    JOIN TemplateComponents tc ON c.id = tc.component_id
    WHERE tc.template_id = $1
  `, [templateId]);
  return componentResult.rows;
}

export async function populateTemplateComponents(payload: any, templateId: number, user: any): Promise<void> {
  const componentRows = await fetchTemplateComponents(templateId);

  if (componentRows.length > 0) {
    if (!payload.component) payload.component = [];
    componentRows.forEach((c: any) => {
      if (!validateUserRoles(user, c.approved_roles || [], c.author_id)) {
        payload.component.push({
          reference: c.name,
          value: c.payload
        });
      }
    });
  }
}
