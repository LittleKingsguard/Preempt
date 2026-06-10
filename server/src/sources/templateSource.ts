import { pool } from "../db.js";

export async function dbCreateTemplate(client: any, authorId: string, payload: any, groupId: number | null) {
  const result = await client.query(
    "INSERT INTO Templates (author_id, group_id, payload) VALUES ($1, $2, $3) RETURNING *",
    [authorId, groupId, payload]
  );
  return result.rows[0];
}

export async function dbGetTemplateAuthorId(client: any, templateId: number) {
  const result = await client.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
  if (result.rows.length === 0) return { error: "Template not found", status: 404 };
  return result.rows[0].author_id;
}

export async function dbUpdateTemplate(client: any, templateId: number, payload: any, groupId: number | null) {
  const result = await client.query(
    "UPDATE Templates SET payload = $1, group_id = COALESCE($2, group_id), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
    [payload, groupId, templateId]
  );
  if (result.rows.length === 0) return { error: "Template not found", status: 404 };
  return result.rows[0];
}

export async function dbGetTemplateForStaging(client: any, originalId: number) {
  const result = await client.query(`
    SELECT t.group_id, t.change_batch_id, cb.merged_at
    FROM Templates t
    LEFT JOIN ChangeBatches cb ON t.change_batch_id = cb.id
    WHERE t.id = $1
  `, [originalId]);
  if (result.rows.length === 0) return { error: "Template not found", status: 404 };
  return result.rows[0];
}

export async function dbUpdateStagedTemplate(client: any, originalId: number, actualGroupId: number | null, payload: any, batchId: number) {
  const result = await client.query(
    "UPDATE Templates SET group_id = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
    [actualGroupId, payload, batchId, originalId]
  );
  if (result.rows.length === 0) return { error: "Staged template not found", status: 404 };
  return result.rows[0];
}

export async function dbInsertStagedTemplate(client: any, authorId: string, actualGroupId: number | null, payload: any, originalId: number | null, batchId: number) {
  const result = await client.query(
    "INSERT INTO Templates (author_id, group_id, payload, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
    [authorId, actualGroupId, payload, originalId, batchId]
  );
  return result.rows[0];
}

import type { ITemplateSource } from "../models/interfaces.js";
export const pgTemplateSource: ITemplateSource = {
  getById: (id: number) => { throw new Error("Not implemented yet"); },
  getForGroup: (id: number) => { throw new Error("Not implemented yet"); },
  getAll: () => { throw new Error("Not implemented yet"); },
  create: dbCreateTemplate,
  getAuthorId: dbGetTemplateAuthorId as any,
  update: dbUpdateTemplate,
  getForStaging: dbGetTemplateForStaging,
  updateStaged: dbUpdateStagedTemplate,
  insertStaged: dbInsertStagedTemplate,
  delete: (id: number) => { throw new Error("Not implemented"); }
};
