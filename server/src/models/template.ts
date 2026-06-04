import { pool } from "../db.js";
import { updateTemplateTags } from "./tag.js";
import { resolveEditorTemplateId, fetchTemplateRecord, populateTemplateHandlers, populateTemplateComponents } from "./templateUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "./editorUtils.js";
import { Node } from "../../../src/core/Node.js";

export async function getTemplateById(id: number, editorMode: string | null = null) {
  const templateIdToFetch = await resolveEditorTemplateId(id, editorMode);
  const template = await fetchTemplateRecord(templateIdToFetch);
  if (!template) return null;

  await populateTemplateHandlers(template.payload, template.id);
  await populateTemplateComponents(template.payload, template.id);

  if (editorMode) {
    const hasEditorTag = await checkHasEditorTag(template.id);
    await injectEditorDependencies(template.payload, null, editorMode, hasEditorTag);
  }

  return template;
}

export async function createTemplate(authorId: string, payload: any, tags: string[], groupId: number | null = null) {
  const virtualNode = new Node(payload);
  if (!virtualNode.validate(true)) {
    return { error: "Validation Error", status: 400 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Templates (author_id, group_id, payload) VALUES ($1, $2, $3) RETURNING *",
      [authorId, groupId, payload]
    );
    const template = result.rows[0];
    if (tags && Array.isArray(tags)) {
      await updateTemplateTags(client, template.id, tags);
    }
    await client.query('COMMIT');
    return { template };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateTemplate(templateId: number, authorId: string, isAdmin: boolean, payload: any, tags: string[], groupId: number | null = null) {
  const virtualNode = new Node(payload);
  if (!virtualNode.validate(true)) {
    return { error: "Validation Error", status: 400 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check ownership
    const check = await client.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Template not found", status: 404 };
    }

    if (check.rows[0].author_id !== authorId && !isAdmin) {
      await client.query('ROLLBACK');
      return { error: "Forbidden: Not the author", status: 403 };
    }

    const result = await client.query(
      "UPDATE Templates SET payload = $1, group_id = COALESCE($2, group_id), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [payload, groupId, templateId]
    );
    if (tags && Array.isArray(tags)) {
      await updateTemplateTags(client, templateId, tags);
    }
    await client.query('COMMIT');
    return { template: result.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function stageTemplate(user: any, payload: any, originalId: number | null, batchId: number, tags: string[] = [], groupId: number | null = null) {
  const virtualNode = new Node(payload);
  if (!virtualNode.validate(true)) {
    return { error: "Validation Error", status: 400 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let actualGroupId = groupId;
    if (!actualGroupId && originalId) {
      const orig = await client.query("SELECT group_id FROM Templates WHERE id = $1", [originalId]);
      if (orig.rows.length > 0) {
        actualGroupId = orig.rows[0].group_id;
      }
    }

    const result = await client.query(
      "INSERT INTO Templates (author_id, group_id, payload, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
      [user.username, actualGroupId, payload, originalId, batchId]
    );
    const template = result.rows[0];
    if (tags && Array.isArray(tags) && tags.length > 0) {
      await updateTemplateTags(client, template.id, tags);
    }
    await client.query('COMMIT');
    return { template };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
