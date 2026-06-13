import { pool } from "../db.js";
import { fetchTemplateHandlers, fetchTemplateComponents } from "./templateUtils.js";
import { queryFirstRow } from "./db.js";
import { validateUserRoles } from "../middleware/auth.js";


export async function checkContentSecurity(resolvedTemplateId: number, editorMode: string | null): Promise<boolean> {
  if (editorMode) return true; // Editor mode handles its own checks
  const securityCheck = await queryFirstRow(`
    SELECT 1 FROM TemplateTags tt
    JOIN Tags tag ON tt.tag_id = tag.id
    WHERE tt.template_id = $1 AND tag.name = 'editor'
  `, [resolvedTemplateId]);
  return !securityCheck;
}

export async function fetchContentHandlers(contentId: number) {
  const contentHandlerResult = await pool.query(`
    SELECT h.name, h.body, h.approved_roles, h.author_id 
    FROM Handlers h
    JOIN ContentHandlers ch ON h.id = ch.handler_id
    WHERE ch.content_id = $1
    UNION
    SELECT h.name, h.body, h.approved_roles, h.author_id
    FROM Handlers h
    JOIN ComponentHandlers ch ON h.id = ch.handler_id
    JOIN ContentComponents cc ON ch.component_id = cc.component_id
    WHERE cc.content_id = $1
  `, [contentId]);
  return contentHandlerResult.rows;
}

export async function populateContentHandlers(contentPayload: any, contentId: number, templateId: number, user: any): Promise<void> {
  const templateHandlerRows = await fetchTemplateHandlers(templateId);
  const contentHandlerRows = await fetchContentHandlers(contentId);

  const handlers = new Map<string, string>();
  templateHandlerRows.forEach((h: any) => {
    if (!validateUserRoles(user, h.approved_roles || [], h.author_id)) {
      handlers.set(h.name, h.body);
    }
  });
  contentHandlerRows.forEach((h: any) => {
    if (!validateUserRoles(user, h.approved_roles || [], h.author_id)) {
      handlers.set(h.name, h.body);
    }
  });

  if (handlers.size > 0) {
    if (!contentPayload.component) contentPayload.component = [];
    for (const [name, body] of handlers.entries()) {
      contentPayload.component.push({ reference: name, value: body });
    }
  }
}

export async function fetchContentComponents(contentId: number) {
  const contentComponentResult = await pool.query(`
    SELECT c.name, c.payload, c.approved_roles, c.author_id 
    FROM Components c
    JOIN ContentComponents cc ON c.id = cc.component_id
    WHERE cc.content_id = $1
  `, [contentId]);
  return contentComponentResult.rows;
}

export async function populateContentComponents(contentPayload: any, contentId: number, templateId: number, user: any): Promise<void> {
  const templateComponentRows = await fetchTemplateComponents(templateId);
  const contentComponentRows = await fetchContentComponents(contentId);

  const components = new Map<string, any>();
  templateComponentRows.forEach((c: any) => {
    if (!validateUserRoles(user, c.approved_roles || [], c.author_id)) {
      components.set(c.name, c.payload);
    }
  });
  contentComponentRows.forEach((c: any) => {
    if (!validateUserRoles(user, c.approved_roles || [], c.author_id)) {
      components.set(c.name, c.payload);
    }
  });

  if (components.size > 0) {
    if (!contentPayload.component) contentPayload.component = [];
    for (const [name, payload] of components.entries()) {
      contentPayload.component.push({ reference: name, value: payload });
    }
  }
}
