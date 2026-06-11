import { pool } from "../db.js";
import { pgTagSource } from "./tagSource.js";
import type { ITemplateSource } from "../models/interfaces.js";

export async function dbCreateTemplate(authorId: string, payload: any, groupId: number | null, tags: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Templates (author_id, group_id, payload) VALUES ($1, $2, $3) RETURNING *",
      [authorId, groupId, payload]
    );
    const row = result.rows[0];

    if (tags && Array.isArray(tags)) {
      await pgTagSource.updateTemplateTags(client, row.id, tags);
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

export async function dbGetTemplateAuthorId(templateId: number) {
  const result = await pool.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
  if (result.rows.length === 0) return { error: "Template not found", status: 404 };
  return result.rows[0].author_id;
}

export async function dbUpdateTemplate(templateId: number, payload: any, groupId: number | null, tags: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "UPDATE Templates SET payload = $1, group_id = COALESCE($2, group_id), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [payload, groupId, templateId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Template not found", status: 404 };
    }
    const row = result.rows[0];

    if (tags && Array.isArray(tags)) {
      await pgTagSource.updateTemplateTags(client, row.id, tags);
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

export async function dbStageTemplate(authorId: string, payload: any, originalId: number | null, batchId: number, groupId: number | null, tags: string[]) {
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
      await pgTagSource.updateTemplateTags(client, row.id, tags);
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

export const pgTemplateSource: ITemplateSource = {
  getById: (id: number) => { throw new Error("Not implemented yet"); },
  getForGroup: (id: number) => { throw new Error("Not implemented yet"); },
  getAll: () => { throw new Error("Not implemented yet"); },
  create: dbCreateTemplate,
  getAuthorId: dbGetTemplateAuthorId as any,
  update: dbUpdateTemplate,
  stage: dbStageTemplate,
  delete: (id: number) => { throw new Error("Not implemented"); }
};
