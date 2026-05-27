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
  if (result.rows.length === 0) return null;

  const content = result.rows[0];

  const templateHandlerResult = await pool.query(`
    SELECT h.name, h.body 
    FROM Handlers h
    JOIN TemplateHandlers th ON h.id = th.handler_id
    JOIN ContentTemplates ct ON th.template_id = ct.template_id
    WHERE ct.content_id = $1
    UNION
    SELECT h.name, h.body
    FROM Handlers h
    JOIN ComponentHandlers ch ON h.id = ch.handler_id
    JOIN TemplateComponents tc ON ch.component_id = tc.component_id
    JOIN ContentTemplates ct ON tc.template_id = ct.template_id
    WHERE ct.content_id = $1
  `, [contentId]);

  const contentHandlerResult = await pool.query(`
    SELECT h.name, h.body 
    FROM Handlers h
    JOIN ContentHandlers ch ON h.id = ch.handler_id
    WHERE ch.content_id = $1
    UNION
    SELECT h.name, h.body
    FROM Handlers h
    JOIN ComponentHandlers ch ON h.id = ch.handler_id
    JOIN ContentComponents cc ON ch.component_id = cc.component_id
    WHERE cc.content_id = $1
  `, [contentId]);

  const handlers = new Map<string, string>();
  
  templateHandlerResult.rows.forEach((h: any) => handlers.set(h.name, h.body));
  contentHandlerResult.rows.forEach((h: any) => handlers.set(h.name, h.body));

  if (handlers.size > 0) {
    if (!content.payload.component) {
      content.payload.component = [];
    }
    for (const [name, body] of handlers.entries()) {
      content.payload.component.push({
        reference: name,
        value: body
      });
    }
  }

  const templateComponentResult = await pool.query(`
    SELECT c.name, c.payload 
    FROM Components c
    JOIN TemplateComponents tc ON c.id = tc.component_id
    JOIN ContentTemplates ct ON tc.template_id = ct.template_id
    WHERE ct.content_id = $1
  `, [contentId]);

  const contentComponentResult = await pool.query(`
    SELECT c.name, c.payload 
    FROM Components c
    JOIN ContentComponents cc ON c.id = cc.component_id
    WHERE cc.content_id = $1
  `, [contentId]);

  const components = new Map<string, any>();
  templateComponentResult.rows.forEach((c: any) => components.set(c.name, c.payload));
  contentComponentResult.rows.forEach((c: any) => components.set(c.name, c.payload));

  if (components.size > 0) {
    if (!content.payload.component) content.payload.component = [];
    for (const [name, payload] of components.entries()) {
      content.payload.component.push({
        reference: name,
        value: payload
      });
    }
  }

  return content;
}
