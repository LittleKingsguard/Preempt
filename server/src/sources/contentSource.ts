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

export async function dbGetContentHeaders(event: IPreemptEvent, id: number) {
  const cacheKey = `getHeaders:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  const row = await queryFirstRow("SELECT headers FROM Content WHERE id = $1", [id]);
  const result = row ? row.headers : null;
  cache.set(cacheKey, { timestamp: Date.now(), value: result });
  fireAndForgetEvent(event);
  return result;
}

async function attachContentMetadata(row: any) {
  if (!row.metadata) {
    row.metadata = {};
  }
  let commentList = await queryFirstRow("SELECT id FROM CommentLists WHERE subject_type = 'Content' AND subject_id = $1", [row.id]);
  
  if (!commentList || 'error' in commentList) {
    commentList = await queryFirstRow("INSERT INTO CommentLists (subject_type, subject_id) VALUES ('Content', $1) ON CONFLICT (subject_type, subject_id) DO UPDATE SET subject_id = EXCLUDED.subject_id RETURNING id", [row.id]);
  }

  if (commentList && !('error' in commentList)) {
    row.metadata.comment_list_id = commentList.id;
  }
  return row.metadata;
}

export async function dbGetContentQuery(event: IPreemptEvent, query: string, params: any[]) {
  const cacheKey = `query:${JSON.stringify({query, params})}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return JSON.parse(JSON.stringify(cached.value));
  }
  
  const row = await queryFirstRow(query, params, "Content not found");
  if (row && !('error' in row)) {
    row.users = await dbGetContentUsers(event, row.id);
    row.groups = await dbGetContentGroups(event, row.id);
    row.metadata = await attachContentMetadata(row);
  }
  
  cache.set(cacheKey, { timestamp: Date.now(), value: row });
  fireAndForgetEvent(event);
  return row ? JSON.parse(JSON.stringify(row)) : row;
}

export async function dbGetContent(event: IPreemptEvent, criteria: { count_only?: boolean; id?: number; hide_pattern?: 'Overlook' | 'Paywall' | 'Guard'; tags?: string[]; author?: string; limit?: number; offset?: number; list_id?: number; columns?: string[] } = {}, user?: any, placeholder?: any) {
  const cacheKey = `get:${JSON.stringify(criteria)}`;
  const cached = cache.get(cacheKey);

  let result;
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    result = JSON.parse(JSON.stringify(cached.value));
  } else {
    let selectClause = 'c.*';
    if (criteria.columns && criteria.columns.length > 0) {
      selectClause = criteria.columns
        .filter(col => col !== 'tags')
        .map(col => col.includes('.') ? col : `c.${col}`)
        .join(', ');
      if (selectClause === '') selectClause = 'c.id';
    }

    if (!criteria.count_only) {
      selectClause += ', (SELECT group_id FROM ContentTemplateGroups WHERE content_id = c.id LIMIT 1) as template_group_id';
    }

    if (!criteria.count_only && (!criteria.columns || criteria.columns.includes('tags'))) {
      selectClause += ', ARRAY(SELECT t.name FROM ContentTags ct JOIN Tags t ON ct.tag_id = t.id WHERE ct.content_id = c.id) as tags';
    }

    let query = `
      SELECT ${criteria.count_only ? 'COUNT(*) as count' : selectClause}
      FROM Content c
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (criteria.id !== undefined) {
      params.push(criteria.id);
      conditions.push(`c.id = $${params.length}`);
    }

    if (criteria.tags && criteria.tags.length > 0) {
      for (const tag of criteria.tags) {
        params.push(tag);
        conditions.push(`EXISTS (
          SELECT 1 FROM ContentTags ct
          JOIN Tags t ON ct.tag_id = t.id
          WHERE ct.content_id = c.id AND t.name = $${params.length}
        )`);
      }
    }

    if (criteria.author) {
      params.push(criteria.author);
      conditions.push(`c.author_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    if (!criteria.count_only) {
      query += ` ORDER BY c.created_at DESC`;
      if (criteria.limit !== undefined) {
        params.push(criteria.limit);
        query += ` LIMIT $${params.length}`;
      } else if (criteria.id === undefined) {
        params.push(10);
        query += ` LIMIT $${params.length}`;
      }
      
      if (criteria.offset !== undefined) {
        params.push(criteria.offset);
        query += ` OFFSET $${params.length}`;
      }
    }

    if (criteria.count_only) {
      const row = await queryFirstRow(query, params);
      result = parseInt(row.count, 10);
    } else if (criteria.id !== undefined) {
      const row = await queryFirstRow(query, params, "Content not found");
      if (row && !('error' in row)) {
        row.users = await dbGetContentUsers(event, row.id);
        row.groups = await dbGetContentGroups(event, row.id);
        row.metadata = await attachContentMetadata(row);
      }
      result = row;
    } else {
      const dbResult = await pool.query(query, params);
      const rows = dbResult.rows;
      for (const row of rows) {
        row.users = await dbGetContentUsers(event, row.id);
        row.groups = await dbGetContentGroups(event, row.id);
        row.metadata = await attachContentMetadata(row);
      }
      result = rows;
    }

    cache.set(cacheKey, { timestamp: Date.now(), value: result });
    
    if (result !== null && typeof result === 'object') {
      result = JSON.parse(JSON.stringify(result));
    }
  }

  // POST-CACHE USER AND BEHAVIOR-SPECIFIC FLOWS
  if (criteria.count_only) {
    fireAndForgetEvent(event);
    return result;
  }

  const now = new Date();
  const isAdmin = user?.is_admin === true;
  const userGroupIds = user?.groups?.map((g: any) => g.id) || [];

  if (criteria.id !== undefined) {
    const row = result;
    if (row && !('error' in row)) {
      const userRole = row.users?.find((u: any) => u.username === user?.username)?.role;
      const groupRole = row.groups?.find((g: any) => userGroupIds.includes(g.group_id))?.role;
      const hasViewAccess = isAdmin || userRole === 'Owner' || userRole === 'Contributor' || userRole === 'Commenter' || userRole === 'Viewer' || groupRole === 'Owner' || groupRole === 'Contributor' || groupRole === 'Commenter' || groupRole === 'Viewer' || row.author_id === user?.username;
      const isPublic = row.is_visible && (!row.live_date || new Date(row.live_date) <= now);

      if (!isPublic && !hasViewAccess) {
        if (criteria.hide_pattern === 'Guard') {
          row.payload = placeholder || { type: "div", content: "Content restricted" };
        } else if (criteria.hide_pattern === 'Paywall') {
          row.payload = row.promo || { message: "Paywall Promo Material" };
        } else if (criteria.hide_pattern === 'Overlook') {
          fireAndForgetEvent(event);
          return { error: "Content not found", status: 404 };
        }
      }
    }
    fireAndForgetEvent(event);
    return row;
  }

  const finalRows = [];
  for (const row of result) {
    const userRole = row.users?.find((u: any) => u.username === user?.username)?.role;
    const groupRole = row.groups?.find((g: any) => userGroupIds.includes(g.group_id))?.role;
    
    const hasViewAccess = isAdmin || userRole === 'Owner' || userRole === 'Contributor' || userRole === 'Commenter' || userRole === 'Viewer' || groupRole === 'Owner' || groupRole === 'Contributor' || groupRole === 'Commenter' || groupRole === 'Viewer' || row.author_id === user?.username;
    const isPublic = row.is_visible && (!row.live_date || new Date(row.live_date) <= now);
    
    if (!isPublic && !hasViewAccess) {
      if (criteria.hide_pattern === 'Overlook') {
        continue;
      } else if (criteria.hide_pattern === 'Guard') {
        row.payload = placeholder || { type: "div", content: "Content restricted" };
      } else if (criteria.hide_pattern === 'Paywall') {
        row.payload = row.promo || { message: "Paywall Promo Material" };
      }
    }
    finalRows.push(row);
  }
  fireAndForgetEvent(event);
  return finalRows;
}

export async function dbGetContentAuthor(event: IPreemptEvent, contentId: number) {
  const cacheKey = `author:${contentId}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  const result = await queryFirstRow("SELECT author_id FROM Content WHERE id = $1", [contentId], "Content not found");
  cache.set(cacheKey, { timestamp: Date.now(), value: result });
  fireAndForgetEvent(event);
  return result;
}

export async function dbStageContent(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[], groupIds: number[], promo?: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let isStagedRow = false;
    if (originalId) {
      const result = await client.query(`
        SELECT c.change_batch_id 
        FROM Content c 
        JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
        WHERE c.id = $1 AND cb.merged_at IS NULL
      `, [originalId]);
      isStagedRow = result.rows.length > 0;
    }

    let row;
    if (isStagedRow) {
      const result = await client.query(
        "UPDATE Content SET author_id = $1, payload = $2, headers = $3, change_batch_id = $4, promo = $5 WHERE id = $6 RETURNING *",
        [authorId, payload, headers, batchId, promo, originalId]
      );
      row = result.rows[0];
    } else {
      const result = await client.query(
        "INSERT INTO Content (author_id, payload, headers, is_visible, original_id, change_batch_id, promo) VALUES ($1, $2, $3, false, $4, $5, $6) RETURNING *",
        [authorId, payload, headers, originalId, batchId, promo]
      );
      row = result.rows[0];
    }

    if (tags && Array.isArray(tags) && (isStagedRow || tags.length > 0)) {
      await pgTagSource.updateContentTags(event, client, row.id, tags);
    }
    if (groupIds && Array.isArray(groupIds) && (isStagedRow || groupIds.length > 0)) {
      await dbUpdateContentTemplateGroups(event, client, row.id, groupIds);
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

export async function dbCreateContent(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | string | null, tags: string[], groupIds: number[], promo?: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Content (author_id, payload, headers, is_visible, live_date, promo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [authorId, payload, headers, isVisible, liveDate, promo]
    );
    const row = result.rows[0];
    
    await client.query(
      "INSERT INTO ContentUsers (content_id, username, role) VALUES ($1, $2, $3)",
      [row.id, authorId, 'Owner']
    );

    if (tags && Array.isArray(tags)) {
      await pgTagSource.updateContentTags(event, client, row.id, tags);
    }
    if (groupIds && Array.isArray(groupIds)) {
      await dbUpdateContentTemplateGroups(event, client, row.id, groupIds);
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

export async function dbUpdateContent(event: IPreemptEvent, contentId: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | string | null, tags: string[], groupIds: number[], promo?: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "UPDATE Content SET author_id = $1, payload = $2, headers = $3, is_visible = $4, live_date = $5, promo = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *",
      [authorId, payload, headers, isVisible, liveDate, promo, contentId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Content not found", status: 404 };
    }
    const row = result.rows[0];

    if (tags && Array.isArray(tags)) {
      await pgTagSource.updateContentTags(event, client, row.id, tags);
    }
    if (groupIds && Array.isArray(groupIds)) {
      await dbUpdateContentTemplateGroups(event, client, row.id, groupIds);
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

export async function dbUpdateContentTemplateGroups(event: IPreemptEvent, client: any, contentId: number, groupIds: number[]) {
  await client.query("DELETE FROM ContentTemplateGroups WHERE content_id = $1", [contentId]);

  if (groupIds && groupIds.length > 0) {
    await client.query("INSERT INTO ContentTemplateGroups (content_id, group_id) SELECT $1, unnest($2::int[])", [contentId, groupIds]);
  }
  cache.clear();
  await logEvent(client, event);
}

export async function dbDeleteContent(event: IPreemptEvent, contentId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query("DELETE FROM Content WHERE id = $1 RETURNING id", [contentId]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Content not found", status: 404 };
    }
    cache.clear();
    await logEvent(client, event);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbAddContentUser(event: IPreemptEvent, contentId: number, username: string, role: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO ContentUsers (content_id, username, role) VALUES ($1, $2, $3) ON CONFLICT (content_id, username) DO UPDATE SET role = EXCLUDED.role RETURNING role",
      [contentId, username, role]
    );
    cache.clear();
    await logEvent(client, event);
    await client.query('COMMIT');
    return result.rows[0].role;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbRemoveContentUser(event: IPreemptEvent, contentId: number, username: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM ContentUsers WHERE content_id = $1 AND username = $2", [contentId, username]);
    cache.clear();
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbGetContentUsers(event: IPreemptEvent, contentId: number) {
  const cacheKey = `users:${contentId}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  const result = await pool.query("SELECT username, role FROM ContentUsers WHERE content_id = $1", [contentId]);
  cache.set(cacheKey, { timestamp: Date.now(), value: result.rows });
  fireAndForgetEvent(event);
  return result.rows;
}

export async function dbAddContentGroup(event: IPreemptEvent, contentId: number, groupId: number, role: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO ContentUserGroups (content_id, group_id, role) VALUES ($1, $2, $3) ON CONFLICT (content_id, group_id) DO UPDATE SET role = EXCLUDED.role RETURNING role",
      [contentId, groupId, role]
    );
    cache.clear();
    await logEvent(client, event);
    await client.query('COMMIT');
    return result.rows[0].role;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbRemoveContentGroup(event: IPreemptEvent, contentId: number, groupId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM ContentUserGroups WHERE content_id = $1 AND group_id = $2", [contentId, groupId]);
    cache.clear();
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbGetContentGroups(event: IPreemptEvent, contentId: number) {
  const cacheKey = `groups:${contentId}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  const result = await pool.query("SELECT group_id, role FROM ContentUserGroups WHERE content_id = $1", [contentId]);
  cache.set(cacheKey, { timestamp: Date.now(), value: result.rows });
  fireAndForgetEvent(event);
  return result.rows;
}

export const pgContentSource: IContentSource = {
  get: dbGetContent,
  query: dbGetContentQuery,
  getHeaders: dbGetContentHeaders,
  stage: dbStageContent,
  create: dbCreateContent,
  update: dbUpdateContent,
  delete: dbDeleteContent,
  addUser: dbAddContentUser,
  removeUser: dbRemoveContentUser,
  getUsers: dbGetContentUsers,
  addGroup: dbAddContentGroup,
  removeGroup: dbRemoveContentGroup,
  getGroups: dbGetContentGroups
};
