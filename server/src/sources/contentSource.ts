import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function dbGetContentHeaders(id: number) {
  const row = await queryFirstRow("SELECT headers FROM Content WHERE id = $1", [id]);
  return row ? row.headers : null;
}

export async function dbGetContentQuery(query: string, params: any[]) {
  return await queryFirstRow(query, params, "Content not found");
}

export async function dbGetContentById(id: number) {
  return await queryFirstRow("SELECT * FROM Content WHERE id = $1", [id], "Content not found");
}

export async function dbGetLatestContent(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}) {
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
  return result.rows;
}

export async function dbGetContentCount(criteria: { tags?: string[]; author?: string } = {}) {
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

export async function dbGetContentForStaging(client: any, originalId: number) {
  const result = await client.query(`
    SELECT c.change_batch_id 
    FROM Content c 
    JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
    WHERE c.id = $1 AND cb.merged_at IS NULL
  `, [originalId]);
  return result.rows.length > 0;
}

export async function dbUpdateStagedContent(client: any, authorId: string, payload: any, headers: string | null, originalId: number, batchId: number) {
  const result = await client.query(
    "UPDATE Content SET author_id = $1, payload = $2, headers = $3, change_batch_id = $4 WHERE id = $5 RETURNING *",
    [authorId, payload, headers, batchId, originalId]
  );
  return result.rows[0];
}

export async function dbInsertStagedContent(client: any, authorId: string, payload: any, headers: string | null, originalId: number | null, batchId: number) {
  const result = await client.query(
    "INSERT INTO Content (author_id, payload, headers, is_visible, original_id, change_batch_id) VALUES ($1, $2, $3, false, $4, $5) RETURNING *",
    [authorId, payload, headers, originalId, batchId]
  );
  return result.rows[0];
}

export async function dbCreateContent(client: any, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | string) {
  const result = await client.query(
    "INSERT INTO Content (author_id, payload, headers, is_visible, live_date) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [authorId, payload, headers, isVisible, liveDate]
  );
  return result.rows[0];
}

export async function dbUpdateContent(client: any, contentId: number, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | string) {
  const result = await client.query(
    "UPDATE Content SET payload = $1, headers = $2, is_visible = $3, live_date = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *",
    [payload, headers, isVisible, liveDate, contentId]
  );
  if (result.rows.length === 0) return { error: "Content not found", status: 404 };
  return result.rows[0];
}

export async function dbDeleteContent(contentId: number) {
  return await queryFirstRow("DELETE FROM Content WHERE id = $1 RETURNING id", [contentId], "Content not found");
}
