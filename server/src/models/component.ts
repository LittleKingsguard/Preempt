import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import { Node } from "../../../src/core/Node.js";

export async function getComponents() {
  const result = await pool.query("SELECT id, name, payload, author_id, created_at, updated_at FROM Components");
  return result.rows;
}

export async function getComponentById(id: number) {
  return await queryFirstRow("SELECT id, name, payload, author_id, created_at, updated_at FROM Components WHERE id = $1", [id]);
}

export async function createComponent(user: any, name: string, payload: any) {
  // admin or contributor can create
  if (!user || (!user.is_admin && !user.is_contributor)) {
    return { error: "Forbidden: Only admins and contributors can create components", status: 403 };
  }

  const virtualNode = new Node(payload);
  if (!virtualNode.validate(true)) {
    return { error: "Invalid layout node tree", status: 400 };
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

  const virtualNode = new Node(payload);
  if (!virtualNode.validate(true)) {
    return { error: "Invalid layout node tree", status: 400 };
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
