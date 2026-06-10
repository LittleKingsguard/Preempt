import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function dbGetComponents() {
  const result = await pool.query("SELECT id, name, payload, author_id, approved_roles, created_at, updated_at FROM Components");
  return result.rows;
}

export async function dbGetComponentById(id: number) {
  return await queryFirstRow("SELECT id, name, payload, author_id, approved_roles, created_at, updated_at FROM Components WHERE id = $1", [id], "Component not found");
}

export async function dbCreateComponent(name: string, payload: any, authorId: string) {
  try {
    return await queryFirstRow(
      "INSERT INTO Components (name, payload, author_id) VALUES ($1, $2, $3) RETURNING *",
      [name, payload, authorId]
    );
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Component with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbUpdateComponent(id: number, name: string, payload: any) {
  return await queryFirstRow(
    "UPDATE Components SET name = $1, payload = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
    [name, payload, id],
    "Component not found"
  );
}

export async function dbDeleteComponent(id: number) {
  return await queryFirstRow("DELETE FROM Components WHERE id = $1 RETURNING id", [id], "Component not found");
}

export async function dbUpdateTemplateComponents(client: any, templateId: number, componentNames: string[]) {
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

export async function dbUpdateContentComponents(client: any, contentId: number, componentNames: string[]) {
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

export async function dbStageComponent(name: string, payload: any, authorId: string, originalId: number | null, batchId: number) {
  if (originalId) {
    const existing = await pool.query(`
      SELECT c.change_batch_id 
      FROM Components c 
      JOIN ChangeBatches cb ON c.change_batch_id = cb.id 
      WHERE c.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    if (existing.rows.length > 0) {
      return await queryFirstRow(
        "UPDATE Components SET name = $1, payload = $2, change_batch_id = $3 WHERE id = $4 RETURNING *",
        [name, payload, batchId, originalId]
      );
    }
  }

  return await queryFirstRow(
    "INSERT INTO Components (name, payload, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
    [name, payload, authorId, originalId, batchId]
  );
}
import type { IComponentSource } from "../models/interfaces.js";
export const pgComponentSource: IComponentSource = {
  getAll: dbGetComponents,
  getById: dbGetComponentById,
  create: dbCreateComponent,
  update: dbUpdateComponent,
  delete: dbDeleteComponent,
  updateTemplateComponents: dbUpdateTemplateComponents,
  updateContentComponents: dbUpdateContentComponents,
  stage: dbStageComponent
};
