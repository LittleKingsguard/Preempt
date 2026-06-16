import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, logEvent, fireAndForgetEvent } from "../utils/db.js";
import { pgTagSource } from "./tagSource.js";
import type { IContentSource } from "../models/interfaces.js";

interface CacheEntry {
  timestamp: number;
  value: any;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute

export async function dbCreateTemplate(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any, metadata?: any) {
  const groupId = groupIds && groupIds.length > 0 ? groupIds[0] : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Templates (author_id, group_id, payload) VALUES ($1, $2, $3) RETURNING *",
      [authorId, groupId, payload]
    );
    const row = result.rows[0];

    if (tags && Array.isArray(tags)) {
      await pgTagSource.updateTemplateTags(event, client, row.id, tags);
    }

    await logEvent(client, event);
    await client.query('COMMIT');
    cache.clear();
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbGetTemplateAuthorId(event: IPreemptEvent, templateId: number) {
  const result = await pool.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
  if (result.rows.length === 0) {
    fireAndForgetEvent(event);
    return { error: "Template not found", status: 404 };
  }
  fireAndForgetEvent(event);
  return result.rows[0].author_id;
}

export async function dbUpdateTemplate(event: IPreemptEvent, id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any, metadata?: any) {
  const groupId = groupIds && groupIds.length > 0 ? groupIds[0] : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "UPDATE Templates SET payload = $1, group_id = COALESCE($2, group_id), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [payload, groupId, id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Template not found", status: 404 };
    }
    const row = result.rows[0];

    if (tags && Array.isArray(tags)) {
      await pgTagSource.updateTemplateTags(event, client, row.id, tags);
    }

    await logEvent(client, event);
    await client.query('COMMIT');
    cache.clear();
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbStageTemplate(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[], groupIds: number[], promo?: any, metadata?: any) {
  const groupId = groupIds && groupIds.length > 0 ? groupIds[0] : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let actualGroupId = groupId;
    let isStagedRow = false;
    
    if (originalId) {
      const origRowRes = await client.query(`
        SELECT t.group_id, t.change_batch_id, cb.merged_at
        FROM Templates t
        LEFT JOIN ChangeBatches cb ON t.change_batch_id = cb.id
        WHERE t.id = $1
      `, [originalId]);
      
      if (origRowRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: "Template not found", status: 404 };
      }
      
      const origRow = origRowRes.rows[0];
      if (!actualGroupId) actualGroupId = origRow.group_id;
      if (origRow.change_batch_id !== null && origRow.merged_at === null) isStagedRow = true;
    }

    let row;
    if (isStagedRow) {
      const result = await client.query(
        "UPDATE Templates SET group_id = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [actualGroupId, payload, batchId, originalId]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: "Staged template not found", status: 404 };
      }
      row = result.rows[0];
    } else {
      const result = await client.query(
        "INSERT INTO Templates (author_id, group_id, payload, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
        [authorId, actualGroupId, payload, originalId, batchId]
      );
      row = result.rows[0];
    }

    if (tags && Array.isArray(tags) && (isStagedRow || tags.length > 0)) {
      await pgTagSource.updateTemplateTags(event, client, row.id, tags);
    }

    await logEvent(client, event);
    await client.query('COMMIT');
    cache.clear();
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbGetTemplate(event: IPreemptEvent, criteria: { count_only?: boolean; id?: number; list_id?: number; tags?: string[] } = {}, user?: any, placeholder?: any) {
  const cacheKey = JSON.stringify(criteria);
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }

  let resultValue;
  if (criteria.id !== undefined) {
    const row = await queryFirstRow("SELECT * FROM Templates WHERE id = $1", [criteria.id], "Template not found");
    resultValue = row;
  } else if (criteria.list_id !== undefined) {
    let query = `
      SELECT t.*,
        (
          SELECT count(*)
          FROM TemplateTags tt
          JOIN Tags tag ON tt.tag_id = tag.id
          WHERE tt.template_id = t.id AND tag.name = ANY($2::text[])
        ) as match_count,
        (t.id = tg.default_template_id) as is_default
      FROM Templates t
      JOIN TemplateGroups tg ON tg.id = t.group_id
      WHERE t.group_id = $1
      ORDER BY match_count DESC, is_default DESC, t.id ASC
      LIMIT 1
    `;
    const params = [criteria.list_id, criteria.tags || []];
    const result = await pool.query(query, params);
    resultValue = result.rows;
  } else {
    throw new Error("Invalid criteria for dbGetTemplate: must provide id or list_id");
  }

  cache.set(cacheKey, { timestamp: Date.now(), value: resultValue });
  fireAndForgetEvent(event);
  return resultValue;
}

export const pgTemplateSource: IContentSource = {
  get: dbGetTemplate,
  getHeaders: async (event: IPreemptEvent) => { throw new Error("Not implemented yet"); },
  query: async (event: IPreemptEvent) => { throw new Error("Not implemented yet"); },
  create: dbCreateTemplate,
  update: dbUpdateTemplate,
  stage: dbStageTemplate,
  delete: async (event: IPreemptEvent, id: number) => { throw new Error("Not implemented"); },
  addUser: async (event: IPreemptEvent) => { throw new Error("Not implemented"); },
  removeUser: async (event: IPreemptEvent) => { throw new Error("Not implemented"); },
  getUsers: async (event: IPreemptEvent) => { throw new Error("Not implemented"); },
  addGroup: async (event: IPreemptEvent) => { throw new Error("Not implemented"); },
  removeGroup: async (event: IPreemptEvent) => { throw new Error("Not implemented"); },
  getGroups: async (event: IPreemptEvent) => { throw new Error("Not implemented"); }
};
