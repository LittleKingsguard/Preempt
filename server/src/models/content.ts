import { pool } from "../db.js";
import { buildContentQuery, applyEditorTemplateOverride, checkContentSecurity, populateContentHandlers, populateContentComponents } from "./contentUtils.js";
import { queryFirstRow } from "../utils/db.js";
import { checkHasEditorTag, injectEditorDependencies } from "./editorUtils.js";
import { updateContentTags, updateContentTemplateGroups } from "./tag.js";
import { validateUserRoles } from "../middleware/auth.js";

export async function getContentHeaders(id: number) {
  const row = await queryFirstRow("SELECT headers FROM Content WHERE id = $1", [id]);
  return row ? row.headers : null;
}

export async function getContentWithTemplate(contentId: number, templateId: number | null, tagsParam: string | null, editorMode: string | null = null, user: any = null) {
  const { query, params } = buildContentQuery(contentId, templateId, tagsParam, editorMode);
  const content = await queryFirstRow(query, params);
  if (!content) return { error: "Content not found", status: 404 };

  if (editorMode) {
    await applyEditorTemplateOverride(content);
  } else if (!(await checkContentSecurity(content.resolved_template_id, editorMode))) {
    return { error: "Security check failed", status: 403 };
  }

  // Access Control (migrated from API layer)
  const isAuthor = user?.username === content.author_id;
  const isAdmin = user?.is_admin === true;
  const now = new Date();

  if (!isAuthor && !isAdmin) {
    if (!content.is_visible) {
      return { error: "Forbidden: Content is not visible", status: 403 };
    }
    if (content.live_date && new Date(content.live_date) > now) {
      return { error: "Forbidden: Content is not live yet", status: 403 };
    }
  }

  const authErr = validateUserRoles(user, content.approved_roles || [], content.author_id);
  if (authErr) return authErr;

  await populateContentHandlers(content.payload, content.id, content.resolved_template_id, user);
  await populateContentComponents(content.payload, content.id, content.resolved_template_id, user);

  if (editorMode) {
    const hasEditorTag = await checkHasEditorTag(content.resolved_template_id);
    await injectEditorDependencies(content.payload, content.template_payload, editorMode, hasEditorTag);
  }

  return { content };
}

export async function getLatestContent(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}) {
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

export async function getContentCount(criteria: { tags?: string[]; author?: string } = {}) {
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

  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count, 10);
}

export async function stageContent(user: any, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[] = [], groupIds: number[] = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let isStagedRow = false;
    if (originalId) {
      const existing = await client.query(`
        SELECT c.change_batch_id 
        FROM Content c 
        JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
        WHERE c.id = $1 AND cb.merged_at IS NULL
      `, [originalId]);
      if (existing.rows.length > 0) {
        isStagedRow = true;
      }
    }

    let content;
    if (isStagedRow) {
      const result = await client.query(
        "UPDATE Content SET author_id = $1, payload = $2, headers = $3, change_batch_id = $4 WHERE id = $5 RETURNING *",
        [user.username, payload, headers, batchId, originalId]
      );
      content = result.rows[0];
    } else {
      const result = await client.query(
        "INSERT INTO Content (author_id, payload, headers, is_visible, original_id, change_batch_id) VALUES ($1, $2, $3, false, $4, $5) RETURNING *",
        [user.username, payload, headers, originalId, batchId]
      );
      content = result.rows[0];
    }
    
    if (tags && Array.isArray(tags)) {
      if (isStagedRow || tags.length > 0) {
        await updateContentTags(client, content.id, tags);
      }
    }
    if (groupIds && Array.isArray(groupIds)) {
      if (isStagedRow || groupIds.length > 0) {
        await updateContentTemplateGroups(client, content.id, groupIds);
      }
    }
    
    await client.query('COMMIT');
    return { content };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function createContent(user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null) {
  if (!user || (!user.is_admin && !user.is_contributor)) {
    return { error: "Forbidden: Only admins and contributors can create content directly", status: 403 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Content (author_id, payload, headers, is_visible, live_date) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [user.username, payload, headers, isVisible, liveDate || new Date()]
    );
    const content = result.rows[0];
    
    if (tags && tags.length > 0) {
      await updateContentTags(client, content.id, tags);
    }
    if (groupIds && groupIds.length > 0) {
      await updateContentTemplateGroups(client, content.id, groupIds);
    }
    
    await client.query('COMMIT');
    return { content };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateContent(contentId: number, user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null) {
  if (!user || (!user.is_admin && !user.is_contributor)) {
    return { error: "Forbidden: Only admins and contributors can update content directly", status: 403 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Authorization check
    const existing = await client.query("SELECT author_id FROM Content WHERE id = $1", [contentId]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Content not found", status: 404 };
    }
    if (!user.is_admin && existing.rows[0].author_id !== user.username) {
      await client.query('ROLLBACK');
      return { error: "Forbidden: You do not own this content", status: 403 };
    }

    const result = await client.query(
      "UPDATE Content SET payload = $1, headers = $2, is_visible = $3, live_date = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *",
      [payload, headers, isVisible, liveDate || new Date(), contentId]
    );
    const content = result.rows[0];
    
    await updateContentTags(client, content.id, tags || []);
    await updateContentTemplateGroups(client, content.id, groupIds || []);
    
    await client.query('COMMIT');
    return { content };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteContent(contentId: number, user: any) {
  if (!user || (!user.is_admin && !user.is_contributor)) {
    return { error: "Forbidden: Only admins and contributors can delete content", status: 403 };
  }
  
  try {
    const existing = await queryFirstRow("SELECT author_id FROM Content WHERE id = $1", [contentId]);
    if (!existing) return { error: "Content not found", status: 404 };
    
    if (!user.is_admin && existing.author_id !== user.username) {
      return { error: "Forbidden: You do not own this content", status: 403 };
    }

    await pool.query("DELETE FROM Content WHERE id = $1", [contentId]);
    return { success: true };
  } catch (err: any) {
    throw err;
  }
}
