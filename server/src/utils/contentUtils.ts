import { PreemptEvent } from '../../../src/types/Event.js';
import { pool } from "../db.js";
import { fetchTemplateHandlers, fetchTemplateComponents } from "./templateUtils.js";
import { queryFirstRow } from "./db.js";
import { validateUserRoles } from "../middleware/auth.js";
import type { IHandlerSource, IComponentSource } from "../models/interfaces.js";


export async function checkContentSecurity(resolvedTemplateId: number, editorMode: string | null): Promise<boolean> {
  if (editorMode) return true; // Editor mode handles its own checks
  const securityCheck = await queryFirstRow(`
    SELECT 1 FROM TemplateTags tt
    JOIN Tags tag ON tt.tag_id = tag.id
    WHERE tt.template_id = $1 AND tag.name = 'editor'
  `, [resolvedTemplateId]);
  return !securityCheck;
}

export async function fetchContentHandlers(contentId: number, handlerSource: IHandlerSource, componentSource: IComponentSource) {
  const components = (await componentSource.getAll(new PreemptEvent('contentUtils.getComponents', { id: 'system', type: 'process' }), { contentId })) || [];
  const componentIds = components.map((c: any) => c.id);

  const criteria: any = { contentId };
  if (componentIds.length > 0) {
    criteria.componentIds = componentIds;
  }

  const allHandlers = (await handlerSource.getAll(new PreemptEvent('contentUtils.getHandlers', { id: 'system', type: 'process' }), criteria)) || [];

  const handlerMap = new Map();
  for (const h of allHandlers) {
    if (!handlerMap.has(h.name)) {
      handlerMap.set(h.name, h);
    }
  }
  return Array.from(handlerMap.values());
}

export async function populateContentHandlers(contentPayload: any, contentId: number, templateId: number, user: any, handlerSource: IHandlerSource, componentSource: IComponentSource): Promise<void> {
  const templateHandlerRows = await fetchTemplateHandlers(templateId, handlerSource, componentSource);
  const contentHandlerRows = await fetchContentHandlers(contentId, handlerSource, componentSource);

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

export async function fetchContentComponents(contentId: number, componentSource: IComponentSource) {
  return (await componentSource.getAll(new PreemptEvent('contentUtils.getComponents', { id: 'system', type: 'process' }), { contentId })) || [];
}

export async function populateContentComponents(contentPayload: any, contentId: number, templateId: number, user: any, componentSource: IComponentSource): Promise<void> {
  const templateComponentRows = await fetchTemplateComponents(templateId, componentSource);
  const contentComponentRows = await fetchContentComponents(contentId, componentSource);

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
