import { PreemptEvent } from '../../../src/types/Event.js';
import { pool } from "../db.js";
import { queryFirstRow } from "./db.js";
import { validateUserRoles } from "../middleware/auth.js";
import type { IHandlerSource, IComponentSource } from "../models/interfaces.js";
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

export async function fetchTemplateHandlers(templateId: number, handlerSource: IHandlerSource, componentSource: IComponentSource) {
  const components = (await componentSource.getAll(new PreemptEvent('templateUtils.getComponents', { id: 'system', type: 'process' }), { templateId })) || [];
  const componentIds = components.map((c: any) => c.id);

  const criteria: any = { templateId };
  if (componentIds.length > 0) {
    criteria.componentIds = componentIds;
  }

  const allHandlers = (await handlerSource.getAll(new PreemptEvent('templateUtils.getHandlers', { id: 'system', type: 'process' }), criteria)) || [];

  const handlerMap = new Map();
  for (const h of allHandlers) {
    if (!handlerMap.has(h.name)) {
      handlerMap.set(h.name, h);
    }
  }
  return Array.from(handlerMap.values());
}

export async function populateTemplateHandlers(payload: any, templateId: number, user: any, handlerSource: IHandlerSource, componentSource: IComponentSource): Promise<void> {
  const handlerRows = await fetchTemplateHandlers(templateId, handlerSource, componentSource);

  if (handlerRows.length > 0) {
    const targetPayload = payload.root || payload;
    if (!targetPayload.component) targetPayload.component = [];
    handlerRows.forEach((h: any) => {
      const val = !validateUserRoles(user, h.approved_roles || [], h.author_id)
        ? { name: h.name, body: h.body }
        : { name: h.name, body: "console.warn('Handler ' + " + JSON.stringify(h.name) + " + ' blocked by RBAC');" };
      const idx = targetPayload.component.findIndex((comp: any) => comp.reference === h.name);
      if (idx >= 0) {
        targetPayload.component[idx] = { reference: h.name, value: val };
      } else {
        targetPayload.component.push({ reference: h.name, value: val });
      }
    });
  }
}

export async function fetchTemplateComponents(templateId: number, componentSource: IComponentSource) {
  return (await componentSource.getAll(new PreemptEvent('templateUtils.getComponents', { id: 'system', type: 'process' }), { templateId })) || [];
}

export async function populateTemplateComponents(payload: any, templateId: number, user: any, componentSource: IComponentSource): Promise<void> {
  const componentRows = await fetchTemplateComponents(templateId, componentSource);
  console.log("populateTemplateComponents", componentRows, templateId);
  if (componentRows.length > 0) {
    const targetPayload = payload.root || payload;
    if (!targetPayload.component) targetPayload.component = [];
    componentRows.forEach((c: any) => {
      const val = !validateUserRoles(user, c.approved_roles || [], c.author_id)
        ? c.payload
        : { type: "div", css: { style: { display: "none" } } };
      const idx = targetPayload.component.findIndex((comp: any) => comp.reference === c.name);
      if (idx >= 0) {
        targetPayload.component[idx] = { ...targetPayload.component[idx], reference: c.name, value: val };
      } else {
        targetPayload.component.push({ reference: c.name, value: val });
      }
    });
  }
}
