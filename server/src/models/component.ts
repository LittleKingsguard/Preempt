import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import { validateUserRoles } from "../middleware/auth.js";

export async function getComponents(user: any) {
  const result = await pool.query("SELECT id, name, payload, author_id, approved_roles, created_at, updated_at FROM Components");
  return result.rows.filter(c => !validateUserRoles(user, c.approved_roles || [], c.author_id));
}

export async function getComponentById(id: number) {
  return await queryFirstRow("SELECT id, name, payload, author_id, approved_roles, created_at, updated_at FROM Components WHERE id = $1", [id]);
}

export async function createComponent(user: any, name: string, payload: any) {
  // admin or contributor can create
  if (!user || (!user.is_admin && !user.is_contributor)) {
    return { error: "Forbidden: Only admins and contributors can create components", status: 403 };
  }

  try {
    const result = await pool.query(
      "INSERT INTO Components (name, payload, author_id) VALUES ($1, $2, $3) RETURNING *",
      [name, payload, user.username]
    );
    return { component: result.rows[0] };
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      return { error: "Component with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function updateComponent(id: number, user: any, name: string, payload: any) {
  // only admin can update
  if (!user || !user.is_admin) {
    return { error: "Forbidden: Only admins can update components", status: 403 };
  }

  try {
    const result = await pool.query(
      "UPDATE Components SET name = $1, payload = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
      [name, payload, id]
    );
    if (result.rows.length === 0) {
      return { error: "Component not found", status: 404 };
    }
    return { component: result.rows[0] };
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      return { error: "Component with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function deleteComponent(id: number, user: any) {
  // only admin can delete
  if (!user || !user.is_admin) {
    return { error: "Forbidden: Only admins can delete components", status: 403 };
  }

  const result = await pool.query("DELETE FROM Components WHERE id = $1 RETURNING id", [id]);
  if (result.rows.length === 0) {
    return { error: "Component not found", status: 404 };
  }
  return { success: true };
}

export async function updateTemplateComponents(client: any, templateId: number, componentNames: string[]) {
  if (!componentNames || componentNames.length === 0) {
    await client.query("DELETE FROM TemplateComponents WHERE template_id = $1", [templateId]);
    return;
  }

  const result = await client.query("SELECT id FROM Components WHERE name = ANY($1::text[])", [componentNames]);
  const componentIds = result.rows.map((r: any) => r.id);

  await client.query("DELETE FROM TemplateComponents WHERE template_id = $1", [templateId]);
  if (componentIds.length > 0) {
    await client.query("INSERT INTO TemplateComponents (template_id, component_id) SELECT $1, unnest($2::int[])", [templateId, componentIds]);
  }
}

export async function updateContentComponents(client: any, contentId: number, componentNames: string[]) {
  if (!componentNames || componentNames.length === 0) {
    await client.query("DELETE FROM ContentComponents WHERE content_id = $1", [contentId]);
    return;
  }

  const result = await client.query("SELECT id FROM Components WHERE name = ANY($1::text[])", [componentNames]);
  const componentIds = result.rows.map((r: any) => r.id);

  await client.query("DELETE FROM ContentComponents WHERE content_id = $1", [contentId]);
  if (componentIds.length > 0) {
    await client.query("INSERT INTO ContentComponents (content_id, component_id) SELECT $1, unnest($2::int[])", [contentId, componentIds]);
  }
}

export async function stageComponent(user: any, name: string, payload: any, originalId: number | null, batchId: number) {
  if (originalId) {
    const existing = await pool.query(`
      SELECT c.change_batch_id 
      FROM Components c 
      JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
      WHERE c.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    if (existing.rows.length > 0) {
      const result = await pool.query(
        "UPDATE Components SET name = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [name, payload, batchId, originalId]
      );
      return { component: result.rows[0] };
    }
  }

  const result = await pool.query(
    "INSERT INTO Components (name, payload, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
    [name, payload, user.username, originalId, batchId]
  );
  return { component: result.rows[0] };
}
