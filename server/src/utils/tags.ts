import { pool } from "../db.js";

let tagCache: Set<string> = new Set();

export async function initTagCache() {
  try {
    const result = await pool.query("SELECT name FROM Tags");
    tagCache = new Set(result.rows.map(r => r.name));
  } catch (err) {
    console.error("Failed to init tag cache", err);
  }
}

export function getTags() {
  return Array.from(tagCache);
}

export async function updateTemplateTags(client: any, templateId: number, tags: string[]) {
  if (!tags || tags.length === 0) {
    await client.query("DELETE FROM TemplateTags WHERE template_id = $1", [templateId]);
    return;
  }
  
  // Batch insert tags
  await client.query("INSERT INTO Tags (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING", [tags]);
  tags.forEach(tag => tagCache.add(tag));

  // Get tag IDs
  const result = await client.query("SELECT id FROM Tags WHERE name = ANY($1::text[])", [tags]);
  const tagIds = result.rows.map((r: any) => r.id);
  
  // Replace mappings
  await client.query("DELETE FROM TemplateTags WHERE template_id = $1", [templateId]);
  if (tagIds.length > 0) {
    await client.query("INSERT INTO TemplateTags (template_id, tag_id) SELECT $1, unnest($2::int[])", [templateId, tagIds]);
  }
}
