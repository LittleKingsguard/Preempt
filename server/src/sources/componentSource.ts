import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

interface CacheEntry {
  timestamp: number;
  value: any;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute

export async function dbGetComponents(criteria?: { templateId?: number; contentId?: number }) {
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
  return result.rows;
}

export async function dbGetComponentById(id: number) {
  const cacheKey = `getById:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  const result = await queryFirstRow("SELECT id, name, payload, author_id, approved_roles, created_at, updated_at FROM Components WHERE id = $1", [id], "Component not found");
  if (result && !('error' in result)) {
    cache.set(cacheKey, { timestamp: Date.now(), value: result });
  }
  return result;
}

export async function dbCreateComponent(name: string, payload: any, authorId: string) {
  try {
    const result = await queryFirstRow(
      "INSERT INTO Components (name, payload, author_id) VALUES ($1, $2, $3) RETURNING *",
      [name, payload, authorId]
    );
    cache.clear();
    return result;
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Component with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbUpdateComponent(id: number, name: string, payload: any) {
  const result = await queryFirstRow(
    "UPDATE Components SET name = $1, payload = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
    [name, payload, id],
    "Component not found"
  );
  cache.clear();
  return result;
}

export async function dbDeleteComponent(id: number) {
  const result = await queryFirstRow("DELETE FROM Components WHERE id = $1 RETURNING id", [id], "Component not found");
  cache.clear();
  return result;
}

export async function dbUpdateTemplateComponents(client: any, templateId: number, componentNames: string[]) {
  if (!componentNames || componentNames.length === 0) {
    await client.query("DELETE FROM TemplateComponents WHERE template_id = $1", [templateId]);
    cache.clear();
    return;
  }

  const result = await client.query("SELECT id FROM Components WHERE name = ANY($1::text[])", [componentNames]);
  const componentIds = result.rows.map((r: any) => r.id);

  await client.query("DELETE FROM TemplateComponents WHERE template_id = $1", [templateId]);
  if (componentIds.length > 0) {
    await client.query("INSERT INTO TemplateComponents (template_id, component_id) SELECT $1, unnest($2::int[])", [templateId, componentIds]);
  }
  cache.clear();
}

export async function dbUpdateContentComponents(client: any, contentId: number, componentNames: string[]) {
  if (!componentNames || componentNames.length === 0) {
    await client.query("DELETE FROM ContentComponents WHERE content_id = $1", [contentId]);
    cache.clear();
    return;
  }

  const result = await client.query("SELECT id FROM Components WHERE name = ANY($1::text[])", [componentNames]);
  const componentIds = result.rows.map((r: any) => r.id);

  await client.query("DELETE FROM ContentComponents WHERE content_id = $1", [contentId]);
  if (componentIds.length > 0) {
    await client.query("INSERT INTO ContentComponents (content_id, component_id) SELECT $1, unnest($2::int[])", [contentId, componentIds]);
  }
  cache.clear();
}

export async function dbStageComponent(name: string, payload: any, authorId: string, originalId: number | null, batchId: number) {
  let result;
  if (originalId) {
    const existing = await pool.query(`
      SELECT c.change_batch_id 
      FROM Components c 
      JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
      WHERE c.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    if (existing.rows.length > 0) {
      result = await queryFirstRow(
        "UPDATE Components SET name = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [name, payload, batchId, originalId]
      );
      cache.clear();
      return result;
    }
  }

  result = await queryFirstRow(
    "INSERT INTO Components (name, payload, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
    [name, payload, authorId, originalId, batchId]
  );
  cache.clear();
  return result;
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
