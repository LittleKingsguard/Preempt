import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function dbGetHandlers() {
  const result = await pool.query("SELECT id, name, body, author_id, is_approved, approved_roles, created_at, updated_at FROM Handlers");
  return result.rows;
}

export async function dbGetHandlerById(id: number) {
  return await queryFirstRow("SELECT id, name, body, author_id, is_approved, approved_roles, created_at, updated_at FROM Handlers WHERE id = $1", [id], "Handler not found");
}

export async function dbCreateHandler(name: string, body: string, authorId: string, isApproved: boolean) {
  try {
    return await queryFirstRow(
      "INSERT INTO Handlers (name, body, author_id, is_approved) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, body, authorId, isApproved]
    );
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Handler with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbUpdateHandler(id: number, name: string, body: string) {
  return await queryFirstRow(
    "UPDATE Handlers SET name = $1, body = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
    [name, body, id],
    "Handler not found"
  );
}

export async function dbUpdateTemplateHandlers(templateId: number, handlerNames: string[]) {
  if (!handlerNames || handlerNames.length === 0) {
    await pool.query("DELETE FROM TemplateHandlers WHERE template_id = $1", [templateId]);
    return;
  }

  const result = await pool.query("SELECT id FROM Handlers WHERE name = ANY($1::text[])", [handlerNames]);
  const handlerIds = result.rows.map((r: any) => r.id);

  await pool.query("DELETE FROM TemplateHandlers WHERE template_id = $1", [templateId]);
  if (handlerIds.length > 0) {
    await pool.query("INSERT INTO TemplateHandlers (template_id, handler_id) SELECT $1, unnest($2::int[])", [templateId, handlerIds]);
  }
}

export async function dbUpdateContentHandlers(contentId: number, handlerNames: string[]) {
  if (!handlerNames || handlerNames.length === 0) {
    await pool.query("DELETE FROM ContentHandlers WHERE content_id = $1", [contentId]);
    return;
  }

  const result = await pool.query("SELECT id FROM Handlers WHERE name = ANY($1::text[])", [handlerNames]);
  const handlerIds = result.rows.map((r: any) => r.id);

  await pool.query("DELETE FROM ContentHandlers WHERE content_id = $1", [contentId]);
  if (handlerIds.length > 0) {
    await pool.query("INSERT INTO ContentHandlers (content_id, handler_id) SELECT $1, unnest($2::int[])", [contentId, handlerIds]);
  }
}

export async function dbStageHandler(name: string, body: string, authorId: string, originalId: number | null, batchId: number) {
  if (originalId) {
    const existing = await pool.query(`
      SELECT h.change_batch_id 
      FROM Handlers h 
      JOIN ChangeBatches cb ON h.change_batch_id = cb.id 
      WHERE h.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    if (existing.rows.length > 0) {
      return await queryFirstRow(
        "UPDATE Handlers SET name = $1, body = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [name, body, batchId, originalId]
      );
    }
  }

  return await queryFirstRow(
    "INSERT INTO Handlers (name, body, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
    [name, body, authorId, originalId, batchId]
  );
}

export async function dbDeleteHandler(id: number) {
  return await queryFirstRow("DELETE FROM Handlers WHERE id = $1 RETURNING *", [id], "Handler not found");
}

export async function dbApproveHandler(id: number, is_approved: boolean) {
  return await queryFirstRow(
    "UPDATE Handlers SET is_approved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
    [is_approved, id],
    "Handler not found"
  );
}
import type { IHandlerSource } from "../models/interfaces.js";
export const pgHandlerSource: IHandlerSource = {
  getAll: dbGetHandlers,
  getById: dbGetHandlerById,
  create: dbCreateHandler,
  update: dbUpdateHandler,
  delete: dbDeleteHandler,
  updateTemplateHandlers: dbUpdateTemplateHandlers,
  updateContentHandlers: dbUpdateContentHandlers,
  stage: dbStageHandler,
  approve: dbApproveHandler
};
