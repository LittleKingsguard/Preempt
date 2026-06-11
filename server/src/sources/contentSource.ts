import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import { pgTagSource } from "./tagSource.js";
import type { IContentSource } from "../models/interfaces.js";

export async function dbGetContentHeaders(id: number) {
  const row = await queryFirstRow("SELECT headers FROM Content WHERE id = $1", [id]);
  return row ? row.headers : null;
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

export async function dbGetContentQuery(query: string, params: any[]) {
  const row = await queryFirstRow(query, params, "Content not found");
  if (row && !('error' in row)) {
    row.users = await dbGetContentUsers(row.id);
    row.groups = await dbGetContentGroups(row.id);
    row.metadata = await attachContentMetadata(row);
  }
  return row;
}

export async function dbGetContentById(id: number, user?: any) {
  const row = await queryFirstRow("SELECT * FROM Content WHERE id = $1", [id], "Content not found");
  if (row && !('error' in row)) {
    row.users = await dbGetContentUsers(row.id);
    row.groups = await dbGetContentGroups(row.id);
    row.metadata = await attachContentMetadata(row);
  }
  return row;
}

export async function dbGetLatestContentOverlook(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number; comment_list_id?: number } = {}, user?: any) {
  let query = `
    SELECT c.* 
    FROM Content c
  `;
  const params: any[] = [];
  const conditions: string[] = [];

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

  if (!user || !user.is_admin) {
    if (user && user.username) {
      params.push(user.username);
      conditions.push(`(
        (c.is_visible = true AND (c.live_date IS NULL OR c.live_date <= CURRENT_TIMESTAMP))
        OR EXISTS (SELECT 1 FROM ContentUsers cu WHERE cu.content_id = c.id AND cu.username = $${params.length})
        OR EXISTS (
          SELECT 1 FROM ContentUserGroups cug 
          JOIN UserGroupMembers ugm ON cug.group_id = ugm.group_id 
          WHERE cug.content_id = c.id AND ugm.username = $${params.length}
        )
      )`);
    } else {
      conditions.push(`c.is_visible = true AND (c.live_date IS NULL OR c.live_date <= CURRENT_TIMESTAMP)`);
    }
  }

  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(' AND ');
  }

  query += ` ORDER BY c.created_at DESC`;

  const limit = criteria.limit || 10;
  params.push(limit);
  query += ` LIMIT $${params.length}`;

  const offset = criteria.offset || 0;
  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);
  const rows = result.rows;

  for (const row of rows) {
    row.users = await dbGetContentUsers(row.id);
    row.groups = await dbGetContentGroups(row.id);
    row.metadata = await attachContentMetadata(row);
  }
  return rows;
}

export async function dbGetLatestContentGuard(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number; comment_list_id?: number } = {}, user?: any, placeholder?: any) {
  const rows = await dbGetLatestContentAll(criteria);
  const now = new Date();
  for (const row of rows) {
    const isAdmin = user?.is_admin === true;
    const userRole = row.users?.find((u: any) => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = row.groups?.find((g: any) => userGroupIds.includes(g.group_id))?.role;
    
    // Evaluate highest privilege if we wanted, but for view access any truthy role suffices
    const hasViewAccess = isAdmin || userRole || groupRole;
    const isPublic = row.is_visible && (!row.live_date || new Date(row.live_date) <= now);
    
    if (!isPublic && !hasViewAccess) {
      row.payload = placeholder || { type: "div", content: "Content restricted" };
    }
  }
  return rows;
}

export async function dbGetLatestContentPaywall(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number; comment_list_id?: number } = {}, user?: any) {
  const rows = await dbGetLatestContentAll(criteria);
  const now = new Date();
  for (const row of rows) {
    const isAdmin = user?.is_admin === true;
    const userRole = row.users?.find((u: any) => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = row.groups?.find((g: any) => userGroupIds.includes(g.group_id))?.role;

    const hasViewAccess = isAdmin || userRole || groupRole;
    const isPublic = row.is_visible && (!row.live_date || new Date(row.live_date) <= now);
    
    if (!isPublic && !hasViewAccess) {
      row.payload = row.promo || { message: "Paywall Promo Material" };
    }
  }
  return rows;
}

async function dbGetLatestContentAll(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number; comment_list_id?: number } = {}) {
  let query = `
    SELECT c.* 
    FROM Content c
  `;
  const params: any[] = [];
  const conditions: string[] = [];

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

  query += ` ORDER BY c.created_at DESC`;

  const limit = criteria.limit || 10;
  params.push(limit);
  query += ` LIMIT $${params.length}`;

  const offset = criteria.offset || 0;
  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);
  const rows = result.rows;

  for (const row of rows) {
    row.users = await dbGetContentUsers(row.id);
    row.groups = await dbGetContentGroups(row.id);
    row.metadata = await attachContentMetadata(row);
  }
  return rows;
}


export async function dbGetContentCountOverlook(criteria: { tags?: string[]; author?: string } = {}, user?: any) {
  let query = `
    SELECT COUNT(*) as count 
    FROM Content c
  `;
  const params: any[] = [];
  const conditions: string[] = [];

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

  if (!user || !user.is_admin) {
    if (user && user.username) {
      params.push(user.username);
      conditions.push(`(
        (c.is_visible = true AND (c.live_date IS NULL OR c.live_date <= CURRENT_TIMESTAMP))
        OR c.author_id = $${params.length}
        OR EXISTS (SELECT 1 FROM ContentUsers cu WHERE cu.content_id = c.id AND cu.username = $${params.length})
      )`);
    } else {
      conditions.push(`c.is_visible = true AND (c.live_date IS NULL OR c.live_date <= CURRENT_TIMESTAMP)`);
    }
  }

  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(' AND ');
  }

  const row = await queryFirstRow(query, params);
  return parseInt(row.count, 10);
}

export async function dbGetContentCountGuard(criteria: { tags?: string[]; author?: string } = {}, user?: any) {
  return await dbGetContentCountAll(criteria);
}

export async function dbGetContentCountPaywall(criteria: { tags?: string[]; author?: string } = {}, user?: any) {
  return await dbGetContentCountAll(criteria);
}

async function dbGetContentCountAll(criteria: { tags?: string[]; author?: string } = {}) {
  let query = `
    SELECT COUNT(*) as count 
    FROM Content c
  `;
  const params: any[] = [];
  const conditions: string[] = [];

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

  const row = await queryFirstRow(query, params);
  return parseInt(row.count, 10);
}

export async function dbGetContentAuthor(contentId: number) {
  return await queryFirstRow("SELECT author_id FROM Content WHERE id = $1", [contentId], "Content not found");
}

export async function dbStageContent(authorId: string, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[], groupIds: number[], promo?: any) {
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
      await pgTagSource.updateContentTags(client, row.id, tags);
    }
    if (groupIds && Array.isArray(groupIds) && (isStagedRow || groupIds.length > 0)) {
      await dbUpdateContentTemplateGroups(client, row.id, groupIds);
    }

    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbCreateContent(authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | string | null, tags: string[], groupIds: number[], promo?: any) {
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
      await pgTagSource.updateContentTags(client, row.id, tags);
    }
    if (groupIds && Array.isArray(groupIds)) {
      await dbUpdateContentTemplateGroups(client, row.id, groupIds);
    }

    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbUpdateContent(contentId: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | string | null, tags: string[], groupIds: number[], promo?: any) {
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
      await pgTagSource.updateContentTags(client, row.id, tags);
    }
    if (groupIds && Array.isArray(groupIds)) {
      await dbUpdateContentTemplateGroups(client, row.id, groupIds);
    }

    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function dbUpdateContentTemplateGroups(client: any, contentId: number, groupIds: number[]) {
  await client.query("DELETE FROM ContentTemplateGroups WHERE content_id = $1", [contentId]);

  if (groupIds && groupIds.length > 0) {
    await client.query("INSERT INTO ContentTemplateGroups (content_id, group_id) SELECT $1, unnest($2::int[])", [contentId, groupIds]);
  }
}

export async function dbDeleteContent(contentId: number) {
  return await queryFirstRow("DELETE FROM Content WHERE id = $1 RETURNING id", [contentId], "Content not found");
}

export async function dbAddContentUser(contentId: number, username: string, role: string) {
  const result = await pool.query(
    "INSERT INTO ContentUsers (content_id, username, role) VALUES ($1, $2, $3) ON CONFLICT (content_id, username) DO UPDATE SET role = EXCLUDED.role RETURNING role",
    [contentId, username, role]
  );
  return result.rows[0].role;
}

export async function dbRemoveContentUser(contentId: number, username: string) {
  await pool.query("DELETE FROM ContentUsers WHERE content_id = $1 AND username = $2", [contentId, username]);
}

export async function dbGetContentUsers(contentId: number) {
  const result = await pool.query("SELECT username, role FROM ContentUsers WHERE content_id = $1", [contentId]);
  return result.rows;
}

export async function dbAddContentGroup(contentId: number, groupId: number, role: string) {
  const result = await pool.query(
    "INSERT INTO ContentUserGroups (content_id, group_id, role) VALUES ($1, $2, $3) ON CONFLICT (content_id, group_id) DO UPDATE SET role = EXCLUDED.role RETURNING role",
    [contentId, groupId, role]
  );
  return result.rows[0].role;
}

export async function dbRemoveContentGroup(contentId: number, groupId: number) {
  await pool.query("DELETE FROM ContentUserGroups WHERE content_id = $1 AND group_id = $2", [contentId, groupId]);
}

export async function dbGetContentGroups(contentId: number) {
  const result = await pool.query("SELECT group_id, role FROM ContentUserGroups WHERE content_id = $1", [contentId]);
  return result.rows;
}

export const pgContentSource: IContentSource = {
  getById: dbGetContentById,
  getHeaders: dbGetContentHeaders,
  query: dbGetContentQuery,
  getLatestOverlook: dbGetLatestContentOverlook,
  getLatestGuard: dbGetLatestContentGuard,
  getLatestPaywall: dbGetLatestContentPaywall,
  getCountOverlook: dbGetContentCountOverlook,
  getCountGuard: dbGetContentCountGuard,
  getCountPaywall: dbGetContentCountPaywall,
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


