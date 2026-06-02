import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function getHandlers() {
  const result = await pool.query("SELECT id, name, body, author_id, is_approved, created_at, updated_at FROM Handlers");
  return result.rows;
}

export async function getHandlerById(id: number) {
  return await queryFirstRow("SELECT id, name, body, author_id, is_approved, created_at, updated_at FROM Handlers WHERE id = $1", [id]);
}

export async function createHandler(user: any, name: string, body: string) {
  if (!user || !user.is_admin) {
    return { error: "Forbidden: Only admins can create handlers", status: 403 };
  }

  try {
    const result = await pool.query(
      "INSERT INTO Handlers (name, body, author_id, is_approved) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, body, user.username, true]
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
  if (!user || !user.is_admin) {
    return { error: "Forbidden: Only admins can update handlers", status: 403 };
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
