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

export async function populateContentHandlers(contentPayload: any, contentId: number, templateId: number, user: any, handlerSource: IHandlerSource, componentSource: IComponentSource, templatePayload?: any): Promise<void> {
  const targetTemplate = templatePayload || contentPayload;
  const handlers = new Map<string, any>();

  if (templateId && targetTemplate) {
    const templateHandlerRows = await fetchTemplateHandlers(templateId, handlerSource, componentSource);
    templateHandlerRows.forEach((h: any) => {
      const body = !validateUserRoles(user, h.approved_roles || [], h.author_id)
        ? h.body
        : "console.warn('Handler ' + " + JSON.stringify(h.name) + " + ' blocked by RBAC');";
      const val: any = { name: h.name, body };
      if (h.event) val.event = h.event;
      if (h.phase) val.phase = h.phase;
      handlers.set(h.name, val);
    });
  }

  if (contentId && contentPayload) {
    const contentHandlerRows = await fetchContentHandlers(contentId, handlerSource, componentSource);
    contentHandlerRows.forEach((h: any) => {
      const body = !validateUserRoles(user, h.approved_roles || [], h.author_id)
        ? h.body
        : "console.warn('Handler ' + " + JSON.stringify(h.name) + " + ' blocked by RBAC');";
      const val: any = { name: h.name, body };
      if (h.event) val.event = h.event;
      if (h.phase) val.phase = h.phase;
      handlers.set(h.name, val);
    });
  }

  if (handlers.size > 0 && targetTemplate) {
    const dest = targetTemplate.root || targetTemplate;
    if (!dest.component) dest.component = [];
    for (const [name, value] of handlers.entries()) {
      const idx = dest.component.findIndex((c: any) => c.reference === name);
      if (idx >= 0) {
        dest.component[idx] = { ...dest.component[idx], reference: name, value };
      } else {
        dest.component.push({ reference: name, value });
      }
    }
  }
}

export async function fetchContentComponents(contentId: number, componentSource: IComponentSource) {
  return (await componentSource.getAll(new PreemptEvent('contentUtils.getComponents', { id: 'system', type: 'process' }), { contentId })) || [];
}

export async function populateContentComponents(contentPayload: any, contentId: number, templateId: number, user: any, componentSource: IComponentSource, templatePayload?: any): Promise<void> {
  const targetTemplate = templatePayload || contentPayload;
  const components = new Map<string, any>();

  if (templateId && targetTemplate) {
    const templateComponentRows = await fetchTemplateComponents(templateId, componentSource);
    templateComponentRows.forEach((c: any) => {
      const payload = !validateUserRoles(user, c.approved_roles || [], c.author_id)
        ? c.payload
        : { type: "div", css: { style: { display: "none" } } };
      components.set(c.name, payload);
    });
  }

  if (contentId && contentPayload) {
    const contentComponentRows = await fetchContentComponents(contentId, componentSource);
    contentComponentRows.forEach((c: any) => {
      const payload = !validateUserRoles(user, c.approved_roles || [], c.author_id)
        ? c.payload
        : { type: "div", css: { style: { display: "none" } } };
      components.set(c.name, payload);
    });
  }

  if (components.size > 0 && targetTemplate) {
    console.log("populateContentComponents", Array.from(components.keys()), templateId);
    const dest = targetTemplate.root || targetTemplate;
    if (!dest.component) dest.component = [];
    for (const [name, payload] of components.entries()) {
      const idx = dest.component.findIndex((c: any) => c.reference === name);
      if (idx >= 0) {
        dest.component[idx] = { ...dest.component[idx], reference: name, value: payload };
      } else {
        dest.component.push({ reference: name, value: payload });
      }
    }
  }
}
