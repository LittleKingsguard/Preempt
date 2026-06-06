import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import { getSetting } from "./settings.js";
import { validateUserRoles } from "../middleware/auth.js";

export async function getHandlers(user: any) {
  const result = await pool.query("SELECT id, name, body, author_id, is_approved, approved_roles, created_at, updated_at FROM Handlers");
  return result.rows.filter(h => !validateUserRoles(user, h.approved_roles || [], h.author_id));
}

export async function getHandlerById(id: number) {
  return await queryFirstRow("SELECT id, name, body, author_id, is_approved, approved_roles, created_at, updated_at FROM Handlers WHERE id = $1", [id]);
}

export async function createHandler(user: any, name: string, body: string) {
  const hasTrustedDevs = await getSetting("hasTrustedDevs");
  const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
  if (!isAuthorized) {
    return { error: "Forbidden: Not authorized to create handlers", status: 403 };
  }

  const isApproved = Boolean(user.is_admin || (hasTrustedDevs && user.is_trusted_dev));

  try {
    const result = await pool.query(
      "INSERT INTO Handlers (name, body, author_id, is_approved) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, body, user.username, isApproved]
    );
    return { handler: result.rows[0] };
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      return { error: "Handler with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function updateHandler(id: number, user: any, name: string, body: string) {
  const hasTrustedDevs = await getSetting("hasTrustedDevs");
  const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
  if (!isAuthorized) {
    return { error: "Forbidden: Not authorized to update handlers", status: 403 };
  }

  try {
    const result = await pool.query(
      "UPDATE Handlers SET name = $1, body = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [name, body, id]
    );
    if (result.rows.length === 0) {
      return { error: "Handler not found", status: 404 };
    }
    return { handler: result.rows[0] };
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      return { error: "Handler with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function updateTemplateHandlers(client: any, templateId: number, handlerNames: string[]) {
  if (!handlerNames || handlerNames.length === 0) {
    await client.query("DELETE FROM TemplateHandlers WHERE template_id = $1", [templateId]);
    return;
  }

  const result = await client.query("SELECT id FROM Handlers WHERE name = ANY($1::text[])", [handlerNames]);
  const handlerIds = result.rows.map((r: any) => r.id);

  await client.query("DELETE FROM TemplateHandlers WHERE template_id = $1", [templateId]);
  if (handlerIds.length > 0) {
    await client.query("INSERT INTO TemplateHandlers (template_id, handler_id) SELECT $1, unnest($2::int[])", [templateId, handlerIds]);
  }
}

export async function updateContentHandlers(client: any, contentId: number, handlerNames: string[]) {
  if (!handlerNames || handlerNames.length === 0) {
    await client.query("DELETE FROM ContentHandlers WHERE content_id = $1", [contentId]);
    return;
  }

  const result = await client.query("SELECT id FROM Handlers WHERE name = ANY($1::text[])", [handlerNames]);
  const handlerIds = result.rows.map((r: any) => r.id);

  await client.query("DELETE FROM ContentHandlers WHERE content_id = $1", [contentId]);
  if (handlerIds.length > 0) {
    await client.query("INSERT INTO ContentHandlers (content_id, handler_id) SELECT $1, unnest($2::int[])", [contentId, handlerIds]);
  }
}

export async function stageHandler(user: any, name: string, body: string, originalId: number | null, batchId: number) {
  if (originalId) {
    const existing = await pool.query(`
      SELECT h.change_batch_id 
      FROM Handlers h 
      JOIN ChangeBatches cb ON h.change_batch_id = cb.id 
      WHERE h.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    if (existing.rows.length > 0) {
      const result = await pool.query(
        "UPDATE Handlers SET name = $1, body = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [name, body, batchId, originalId]
      );
      return { handler: result.rows[0] };
    }
  }

  const result = await pool.query(
    "INSERT INTO Handlers (name, body, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
    [name, body, user.username, originalId, batchId]
  );
  return { handler: result.rows[0] };
}

export async function deleteHandler(id: number, user: any) {
  const hasTrustedDevs = await getSetting("hasTrustedDevs");
  const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
  if (!isAuthorized) {
    return { error: "Forbidden: Not authorized to delete handlers", status: 403 };
  }

  try {
    const result = await pool.query("DELETE FROM Handlers WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return { error: "Handler not found", status: 404 };
    }
    return { handler: result.rows[0] };
  } catch (err: any) {
    throw err;
  }
}

export async function approveHandler(id: number, user: any, is_approved: boolean) {
  const hasTrustedDevs = await getSetting("hasTrustedDevs");
  const isAuthorized = user && (user.is_admin || (hasTrustedDevs && user.is_trusted_dev));
  if (!isAuthorized) {
    return { error: "Forbidden: Not authorized to approve/reject handlers", status: 403 };
  }

  try {
    const result = await pool.query(
      "UPDATE Handlers SET is_approved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [is_approved, id]
    );
    if (result.rows.length === 0) {
      return { error: "Handler not found", status: 404 };
    }
    return { handler: result.rows[0] };
  } catch (err: any) {
    throw err;
  }
}
