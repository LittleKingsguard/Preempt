import { pool } from "../db.js";
import { updateTemplateTags } from "./tag.js";

export async function getTemplateById(id: number, editorMode: string | null = null) {
  let templateIdToFetch = id;

  if (editorMode) {
    const editorTagCheck = await pool.query(`
      SELECT t.id FROM TemplateTags tt
      JOIN Tags tag ON tt.tag_id = tag.id
      JOIN Templates t ON tt.template_id = t.id
      JOIN Templates rt ON t.group_id = rt.group_id
      WHERE rt.id = $1 AND tag.name = 'editor'
      LIMIT 1
    `, [id]);
    
    if (editorTagCheck.rows.length > 0) {
      templateIdToFetch = editorTagCheck.rows[0].id;
    }
  }

  const result = await pool.query("SELECT * FROM Templates WHERE id = $1", [templateIdToFetch]);
  if (result.rows.length === 0) return null;
  
  const template = result.rows[0];
  const resolvedTemplateId = template.id;
  
  const handlerResult = await pool.query(`
    SELECT h.name, h.body 
    FROM Handlers h
    JOIN TemplateHandlers th ON h.id = th.handler_id
    WHERE th.template_id = $1
    UNION
    SELECT h.name, h.body
    FROM Handlers h
    JOIN ComponentHandlers ch ON h.id = ch.handler_id
    JOIN TemplateComponents tc ON ch.component_id = tc.component_id
    WHERE tc.template_id = $1
  `, [resolvedTemplateId]);

  if (handlerResult.rows.length > 0) {
    if (!template.payload.component) {
      template.payload.component = [];
    }
    handlerResult.rows.forEach((h: any) => {
      template.payload.component.push({
        reference: h.name,
        value: h.body
      });
    });
  }

  const componentResult = await pool.query(`
    SELECT c.name, c.payload 
    FROM Components c
    JOIN TemplateComponents tc ON c.id = tc.component_id
    WHERE tc.template_id = $1
  `, [resolvedTemplateId]);

  if (componentResult.rows.length > 0) {
    if (!template.payload.component) template.payload.component = [];
    componentResult.rows.forEach((c: any) => {
      template.payload.component.push({
        reference: c.name,
        value: c.payload
      });
    });
  }

  if (editorMode) {
    const tagCheck = await pool.query(`
      SELECT 1 FROM TemplateTags tt
      JOIN Tags tag ON tt.tag_id = tag.id
      JOIN Templates t ON tt.template_id = t.id
      JOIN Templates rt ON t.group_id = rt.group_id
      WHERE rt.id = $1 AND tag.name = 'editor'
    `, [resolvedTemplateId]);

    const hasEditorTag = tagCheck.rows.length > 0;

    if (!hasEditorTag) {
      if (!template.payload.content) template.payload.content = [];
      if (!Array.isArray(template.payload.content)) {
        template.payload.content = [template.payload.content];
      }
      template.payload.content.push({
        type: "div",
        component: [
          { reference: "PreemptEditor", target: "type" },
          { reference: "editorMode", target: "props.mode", value: editorMode }
        ]
      });

      const editorComponentRes = await pool.query(`SELECT payload FROM Components WHERE name = 'PreemptEditor'`);
      if (editorComponentRes.rows.length > 0) {
        if (!template.payload.component) template.payload.component = [];
        template.payload.component.push({
          reference: "PreemptEditor",
          value: editorComponentRes.rows[0].payload
        });
      }

      const editorHandlersRes = await pool.query(`
        SELECT h.name, h.body FROM Handlers h
        JOIN ComponentHandlers ch ON h.id = ch.handler_id
        JOIN Components c ON ch.component_id = c.id
        WHERE c.name = 'PreemptEditor'
      `);
      editorHandlersRes.rows.forEach((h: any) => {
        template.payload.component.push({
          reference: h.name,
          value: h.body
        });
      });
    }
  }

  return template;
}

export async function createTemplate(authorId: string, payload: any, tags: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Templates (author_id, payload) VALUES ($1, $2) RETURNING *",
      [authorId, payload]
    );
    const template = result.rows[0];
    if (tags && Array.isArray(tags)) {
      await updateTemplateTags(client, template.id, tags);
    }
    await client.query('COMMIT');
    return template;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateTemplate(templateId: number, authorId: string, isAdmin: boolean, payload: any, tags: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check ownership
    const check = await client.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: "Template not found", status: 404 };
    }

    if (check.rows[0].author_id !== authorId && !isAdmin) {
      await client.query('ROLLBACK');
      return { error: "Forbidden: Not the author", status: 403 };
    }

    const result = await client.query(
      "UPDATE Templates SET payload = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [payload, templateId]
    );
    if (tags && Array.isArray(tags)) {
      await updateTemplateTags(client, templateId, tags);
    }
    await client.query('COMMIT');
    return { template: result.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
