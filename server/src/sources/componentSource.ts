import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";

interface CacheEntry {
  timestamp: number;
  value: any;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute

export async function dbGetComponents(event: IPreemptEvent, criteria?: { templateId?: number; contentId?: number }) {
  const cacheKey = criteria ? `getAll:${JSON.stringify(criteria)}` : 'getAll';
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }

  let query = "SELECT c.id, c.name, c.payload, c.author_id, c.approved_roles, c.created_at, c.updated_at FROM Components c";
  const params: any[] = [];
  const conditions: string[] = [];

  if (criteria?.templateId !== undefined) {
    query += " JOIN TemplateComponents tc ON c.id = tc.component_id";
    params.push(criteria.templateId);
    conditions.push(`tc.template_id = $${params.length}`);
  } else if (criteria?.contentId !== undefined) {
    query += " JOIN ContentComponents cc ON c.id = cc.component_id";
    params.push(criteria.contentId);
    conditions.push(`cc.content_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  const result = await pool.query(query, params);
  cache.set(cacheKey, { timestamp: Date.now(), value: result.rows });
  fireAndForgetEvent(event);
  return result.rows;
}

export async function dbGetComponentById(event: IPreemptEvent, id: number, client?: any) {
  const cacheKey = `getById:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  const result = await queryFirstRow("SELECT id, name, payload, author_id, approved_roles, created_at, updated_at FROM Components WHERE id = $1", [id], "Component not found", client);
  if (result && !('error' in result)) {
    cache.set(cacheKey, { timestamp: Date.now(), value: result });
  }
  fireAndForgetEvent(event);
  return result;
}

export async function dbCreateComponent(event: IPreemptEvent, name: string, payload: any, authorId: string) {
  const cte = getLogEventCTE(event, 4);
  try {
    const result = await pool.query(
      `WITH inserted AS (
         INSERT INTO Components (name, payload, author_id) VALUES ($1, $2, $3) RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM inserted`,
      [name, payload, authorId, ...cte.params]
    );
    cache.clear();
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Component with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbUpdateComponent(event: IPreemptEvent, id: number, name: string, payload: any) {
  const cte = getLogEventCTE(event, 4);
  const result = await pool.query(
    `WITH updated AS (
       UPDATE Components SET name = $1, payload = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *
     ),
     ${cte.sql}
     SELECT * FROM updated`,
    [name, payload, id, ...cte.params]
  );
  if (result.rows.length === 0) {
    return { error: "Component not found", status: 404 };
  }
  cache.clear();
  return result.rows[0];
}

export async function dbDeleteComponent(event: IPreemptEvent, id: number) {
  const cte = getLogEventCTE(event, 2);
  const result = await pool.query(
    `WITH deleted AS (
       DELETE FROM Components WHERE id = $1 RETURNING id
     ),
     ${cte.sql}
     SELECT * FROM deleted`,
    [id, ...cte.params]
  );
  if (result.rows.length === 0) {
    return { error: "Component not found", status: 404 };
  }
  cache.clear();
  return result.rows[0];
}

export async function dbUpdateTemplateComponents(event: IPreemptEvent, client: any, templateId: number, componentNames: string[]) {
  const logCte = getLogEventCTE(event, 3);
  if (!componentNames || componentNames.length === 0) {
    await pool.query(`WITH deleted AS (DELETE FROM TemplateComponents WHERE template_id = $1), ${logCte.sql} SELECT 1`, [templateId, null, ...logCte.params]);
    cache.clear();
    return;
  }
  await pool.query(`
    WITH ${buildUpdateTemplateComponentsCTE('$1', 2)},
    ${logCte.sql}
    SELECT 1
  `, [templateId, componentNames, ...logCte.params]);
  cache.clear();
}

export function buildUpdateTemplateComponentsCTE(templateIdRef: string, componentsParamIdx: number) {
  return `
    deleted_template_components AS (
      DELETE FROM TemplateComponents WHERE template_id = ${templateIdRef}
    ),
    inserted_template_components AS (
      INSERT INTO TemplateComponents (template_id, component_id)
      SELECT ${templateIdRef}, id FROM Components WHERE name = ANY($${componentsParamIdx}::text[])
    )
  `;
}

export async function dbUpdateContentComponents(event: IPreemptEvent, client: any, contentId: number, componentNames: string[]) {
  const logCte = getLogEventCTE(event, 3);
  if (!componentNames || componentNames.length === 0) {
    await pool.query(`WITH deleted AS (DELETE FROM ContentComponents WHERE content_id = $1), ${logCte.sql} SELECT 1`, [contentId, null, ...logCte.params]);
    cache.clear();
    return;
  }
  await pool.query(`
    WITH ${buildUpdateContentComponentsCTE('$1', 2)},
    ${logCte.sql}
    SELECT 1
  `, [contentId, componentNames, ...logCte.params]);
  cache.clear();
}

export function buildUpdateContentComponentsCTE(contentIdRef: string, componentsParamIdx: number) {
  return `
    deleted_content_components AS (
      DELETE FROM ContentComponents WHERE content_id = ${contentIdRef}
    ),
    inserted_content_components AS (
      INSERT INTO ContentComponents (content_id, component_id)
      SELECT ${contentIdRef}, id FROM Components WHERE name = ANY($${componentsParamIdx}::text[])
    )
  `;
}

export async function dbStageComponent(event: IPreemptEvent, name: string, payload: any, authorId: string, originalId: number | null, batchId: number) {
  const cte = getLogEventCTE(event, 6);
  let isStagedRow = false;
  
  if (originalId) {
    const origRowRes = await pool.query(`
      SELECT c.change_batch_id 
      FROM Components c 
      JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
      WHERE c.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    if (origRowRes.rows.length > 0) {
      isStagedRow = true;
    }
  }

  let result;
  if (isStagedRow) {
    result = await pool.query(
      `WITH updated AS (
         UPDATE Components SET name = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM updated`,
      [name, payload, batchId, originalId, null, ...cte.params] // param 5 is null filler to align with cte.params start index 6
    );
    if (result.rows.length === 0) {
      return { error: "Staged component not found", status: 404 };
    }
  } else {
    result = await pool.query(
      `WITH inserted AS (
         INSERT INTO Components (name, payload, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM inserted`,
      [name, payload, authorId, originalId, batchId, ...cte.params]
    );
  }
  cache.clear();
  return result.rows[0];
}
import type { IComponentSource } from "../models/interfaces.js";
export const pgComponentSource: IComponentSource = {
  getAll: dbGetComponents,
  getById: dbGetComponentById,
  create: dbCreateComponent,
  update: dbUpdateComponent,
  delete: dbDeleteComponent,
  updateTemplateComponents: dbUpdateTemplateComponents,
  updateContentComponents: dbUpdateContentComponents,
  stage: dbStageComponent
};
