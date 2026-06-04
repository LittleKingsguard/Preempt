import { pool } from "../db.js";
import { buildContentQuery, applyEditorTemplateOverride, checkContentSecurity, populateContentHandlers, populateContentComponents } from "./contentUtils.js";
import { queryFirstRow } from "../utils/db.js";
import { checkHasEditorTag, injectEditorDependencies } from "./editorUtils.js";

export async function getContentHeaders(id: number) {
  const row = await queryFirstRow("SELECT headers FROM Content WHERE id = $1", [id]);
  return row ? row.headers : null;
}

export async function getContentWithTemplate(contentId: number, templateId: number | null, tagsParam: string | null, editorMode: string | null = null) {
  const { query, params } = buildContentQuery(contentId, templateId, tagsParam, editorMode);
  const content = await queryFirstRow(query, params);
  if (!content) return null;

  if (editorMode) {
    await applyEditorTemplateOverride(content);
  } else if (!(await checkContentSecurity(content.resolved_template_id, editorMode))) {
    return null;
  }

  await populateContentHandlers(content.payload, content.id, content.resolved_template_id);
  await populateContentComponents(content.payload, content.id, content.resolved_template_id);

  if (editorMode) {
    const hasEditorTag = await checkHasEditorTag(content.resolved_template_id);
    await injectEditorDependencies(content.payload, content.template_payload, editorMode, hasEditorTag);
  }

  return content;
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

export async function stageContent(user: any, payload: any, headers: string | null, originalId: number | null, batchId: number) {
  const result = await pool.query(
    "INSERT INTO Content (author_id, payload, headers, is_visible, original_id, change_batch_id) VALUES ($1, $2, $3, false, $4, $5) RETURNING *",
    [user.username, payload, headers, originalId, batchId]
  );
  return { content: result.rows[0] };
}
