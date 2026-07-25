import { PreemptEvent } from '../../../src/types/Event.js';
import { pool } from "../db.js";
import { fetchTemplateHandlers, fetchTemplateComponents, upsertComponentReference } from "./templateUtils.js";
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

export async function populateContentHandlers(contentPayload: any, contentId: number, user: any, handlerSource: IHandlerSource, componentSource: IComponentSource): Promise<void> {
  if (contentId && contentPayload) {
    const contentHandlerRows = await fetchContentHandlers(contentId, handlerSource, componentSource);
    contentHandlerRows.forEach((h: any) => {
      const body = !validateUserRoles(user, h.approved_roles || [], h.author_id)
        ? h.body
        : "console.warn('Handler ' + " + JSON.stringify(h.name) + " + ' blocked by RBAC');";
      const val: any = { name: h.name, body };
      if (h.event) val.event = h.event;
      if (h.phase) val.phase = h.phase;
      
      upsertComponentReference(contentPayload, h.name, val);
    });
  }
}

export async function fetchContentComponents(contentId: number, componentSource: IComponentSource) {
  return (await componentSource.getAll(new PreemptEvent('contentUtils.getComponents', { id: 'system', type: 'process' }), { contentId })) || [];
}

export async function populateContentComponents(contentPayload: any, contentId: number, user: any, componentSource: IComponentSource): Promise<void> {
  if (contentId && contentPayload) {
    const contentComponentRows = await fetchContentComponents(contentId, componentSource);
    contentComponentRows.forEach((c: any) => {
      const payload = !validateUserRoles(user, c.approved_roles || [], c.author_id)
        ? c.payload
        : { type: "div", css: { style: { display: "none" } } };
      upsertComponentReference(contentPayload, c.name, payload);
    });
  }
}

export async function populateContent(contentPayload: any, contentId: number, user: any, handlerSource: IHandlerSource, componentSource: IComponentSource): Promise<void> {
  await populateContentHandlers(contentPayload, contentId, user, handlerSource, componentSource);
  await populateContentComponents(contentPayload, contentId, user, componentSource);
}
