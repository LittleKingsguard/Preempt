import { pool } from "../db.js";

export async function getContentHeaders(id: number) {
  const result = await pool.query("SELECT headers FROM Content WHERE id = $1", [id]);
  return result.rows.length > 0 ? result.rows[0].headers : null;
}

export async function getContentWithTemplate(contentId: number, templateId: number | null, tagsParam: string | null) {
  let query = `
    SELECT c.*, t.payload as template_payload
    FROM Content c
    JOIN ContentTemplates ct ON c.id = ct.content_id
    JOIN Templates t ON ct.template_id = t.id
    WHERE c.id = $1
  `;
  const params: any[] = [contentId];

  if (templateId) {
    query += ` AND t.id = $2`;
    params.push(templateId);
  } else if (tagsParam) {
    const tagsArray = tagsParam.split(',').map(t => t.trim()).filter(t => t);
    if (tagsArray.length > 0) {
      query = `
        SELECT c.*, t.payload as template_payload,
          (
            SELECT count(*)
            FROM TemplateTags tt
            JOIN Tags tag ON tt.tag_id = tag.id
            WHERE tt.template_id = t.id AND tag.name = ANY($2::text[])
          ) as match_count
        FROM Content c
        JOIN ContentTemplates ct ON c.id = ct.content_id
        JOIN Templates t ON ct.template_id = t.id
        WHERE c.id = $1
        ORDER BY match_count DESC, t.id ASC
        LIMIT 1
      `;
      params.push(tagsArray);
    } else {
      query += ` LIMIT 1`;
    }
  } else {
    query += ` LIMIT 1`;
  }

  const result = await pool.query(query, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}
