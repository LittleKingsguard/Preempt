import { pool } from "../db.js";
import { updateTemplateTags } from "./tag.js";
import { resolveEditorTemplateId, fetchTemplateRecord, populateTemplateHandlers, populateTemplateComponents } from "../utils/templateUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "../utils/editorUtils.js";
import { Node } from "../../../src/core/Node.js";
import { validateUserRoles } from "../middleware/auth.js";

export async function getTemplateById(id: number, editorMode: string | null = null, user: any = null) {
  const templateIdToFetch = await resolveEditorTemplateId(id, editorMode);
  const template = await fetchTemplateRecord(templateIdToFetch);
  if (!template) return { error: "Template not found", status: 404 };

  const authErr = validateUserRoles(user, template.approved_roles || [], template.author_id);
  if (authErr) return authErr;

  await populateTemplateHandlers(template.payload, template.id, user);
  await populateTemplateComponents(template.payload, template.id, user);

  if (editorMode) {
    const hasEditorTag = await checkHasEditorTag(template.id);
    await injectEditorDependencies(template.payload, null, editorMode, hasEditorTag);
  }

  return { template };
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
    let isStagedRow = false;
    
    if (originalId) {
      const orig = await client.query(`
        SELECT t.group_id, t.change_batch_id, cb.merged_at
        FROM Templates t
        LEFT JOIN ChangeBatches cb ON t.change_batch_id = cb.id
        WHERE t.id = $1
      `, [originalId]);
      if (orig.rows.length > 0) {
        if (!actualGroupId) actualGroupId = orig.rows[0].group_id;
        if (orig.rows[0].change_batch_id !== null && orig.rows[0].merged_at === null) isStagedRow = true;
      }
    }

    let template;
    if (isStagedRow) {
      const result = await client.query(
        "UPDATE Templates SET group_id = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [actualGroupId, payload, batchId, originalId]
      );
      template = result.rows[0];
    } else {
      const result = await client.query(
        "INSERT INTO Templates (author_id, group_id, payload, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
        [user.username, actualGroupId, payload, originalId, batchId]
      );
      template = result.rows[0];
    }

    if (tags && Array.isArray(tags)) {
      if (isStagedRow || tags.length > 0) {
        await updateTemplateTags(client, template.id, tags);
      }
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
