import { pool } from "../db.js";

export async function dbFetchAllTags(): Promise<string[]> {
  const result = await pool.query("SELECT name FROM Tags");
  return result.rows.map((r: any) => r.name);
}

export async function dbUpdateTemplateTags(client: any, templateId: number, tags: string[]) {
  if (!tags || tags.length === 0) {
    await client.query("DELETE FROM TemplateTags WHERE template_id = $1", [templateId]);
    return;
  }
  
  await client.query("INSERT INTO Tags (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING", [tags]);

  const result = await client.query("SELECT id FROM Tags WHERE name = ANY($1::text[])", [tags]);
  const tagIds = result.rows.map((r: any) => r.id);
  
  await client.query("DELETE FROM TemplateTags WHERE template_id = $1", [templateId]);
  if (tagIds.length > 0) {
    await client.query("INSERT INTO TemplateTags (template_id, tag_id) SELECT $1, unnest($2::int[])", [templateId, tagIds]);
  }
}

export async function dbUpdateContentTags(client: any, contentId: number, tags: string[]) {
  if (!tags || tags.length === 0) {
    await client.query("DELETE FROM ContentTags WHERE content_id = $1", [contentId]);
    return;
  }
  
  await client.query("INSERT INTO Tags (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING", [tags]);

  const result = await client.query("SELECT id FROM Tags WHERE name = ANY($1::text[])", [tags]);
  const tagIds = result.rows.map((r: any) => r.id);
  
  await client.query("DELETE FROM ContentTags WHERE content_id = $1", [contentId]);
  if (tagIds.length > 0) {
    await client.query("INSERT INTO ContentTags (content_id, tag_id) SELECT $1, unnest($2::int[])", [contentId, tagIds]);
  }
}



import type { ITagSource } from "../models/interfaces.js";
export const pgTagSource: ITagSource = {
  fetchAll: dbFetchAllTags,
  updateTemplateTags: dbUpdateTemplateTags,
  updateContentTags: dbUpdateContentTags
};
