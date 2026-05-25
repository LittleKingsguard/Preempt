import { pool } from "../db.js";
import { updateTemplateTags } from "./tag.js";

export async function getTemplateById(id: number) {
  const result = await pool.query("SELECT * FROM Templates WHERE id = $1", [id]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function createTemplate(authorId: string, payload: any, tags: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Templates (author_id, payload) VALUES ($1, $2) RETURNING *",
      [authorId, payload]
    );
    const template = result.rows[0];
    if (tags && Array.isArray(tags)) {
      await updateTemplateTags(client, template.id, tags);
    }
    await client.query('COMMIT');
    return template;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateTemplate(templateId: number, authorId: string, isAdmin: boolean, payload: any, tags: string[]) {
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
      "UPDATE Templates SET payload = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [payload, templateId]
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
