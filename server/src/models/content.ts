import { pool } from "../db.js";

export async function getContentHeaders(id: number) {
  const result = await pool.query("SELECT headers FROM Content WHERE id = $1", [id]);
  return result.rows.length > 0 ? result.rows[0].headers : null;
}

export async function getContentWithTemplate(contentId: number, templateId: number | null, tagsParam: string | null, editorMode: string | null = null) {
  let query = "";
  const params: any[] = [contentId];

  const tagsArray = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(t => t) : [];
  if (editorMode) {
    tagsArray.push("editor");
  }

  if (templateId) {
    query = `
      SELECT c.*, t.payload as template_payload, t.id as resolved_template_id
      FROM Content c
      JOIN ContentTemplateGroups ctg ON c.id = ctg.content_id
      JOIN Templates t ON t.group_id = ctg.group_id
      WHERE c.id = $1 AND t.id = $2
    `;
    params.push(templateId);
  } else if (tagsArray.length > 0) {
    query = `
      SELECT c.*, t.payload as template_payload, t.id as resolved_template_id,
        (
          SELECT count(*)
          FROM TemplateTags tt
          JOIN Tags tag ON tt.tag_id = tag.id
          WHERE tt.template_id = t.id AND tag.name = ANY($2::text[])
        ) as match_count,
        (t.id = tg.default_template_id) as is_default
      FROM Content c
      JOIN ContentTemplateGroups ctg ON c.id = ctg.content_id
      JOIN TemplateGroups tg ON tg.id = ctg.group_id
      JOIN Templates t ON t.group_id = ctg.group_id
      WHERE c.id = $1
      ORDER BY match_count DESC, is_default DESC, t.id ASC
      LIMIT 1
    `;
    params.push(tagsArray);
  } else {
    query = `
      SELECT c.*, t.payload as template_payload, t.id as resolved_template_id
      FROM Content c
      JOIN ContentTemplateGroups ctg ON c.id = ctg.content_id
      JOIN TemplateGroups tg ON ctg.group_id = tg.id
      JOIN Templates t ON t.id = tg.default_template_id
      WHERE c.id = $1
    `;
  }

  const result = await pool.query(query, params);
  if (result.rows.length === 0) return null;

  const content = result.rows[0];
  let resolvedTemplateId = content.resolved_template_id;

  if (editorMode) {
    const editorTemplateCheck = await pool.query(`
      SELECT t.id, t.payload FROM TemplateTags tt
      JOIN Tags tag ON tt.tag_id = tag.id
      JOIN Templates t ON tt.template_id = t.id
      JOIN Templates rt ON t.group_id = rt.group_id
      WHERE rt.id = $1 AND tag.name = 'editor'
      LIMIT 1
    `, [resolvedTemplateId]);

    if (editorTemplateCheck.rows.length > 0) {
      const editorTemplate = editorTemplateCheck.rows[0];
      if (editorTemplate.id !== resolvedTemplateId) {
        content.template_payload = editorTemplate.payload;
        resolvedTemplateId = editorTemplate.id;
      }
    }
  }

  if (!editorMode) {
    const securityCheck = await pool.query(`
      SELECT 1 FROM TemplateTags tt
      JOIN Tags tag ON tt.tag_id = tag.id
      WHERE tt.template_id = $1 AND tag.name = 'editor'
    `, [resolvedTemplateId]);
    if (securityCheck.rows.length > 0) return null;
  }

  const templateHandlerResult = await pool.query(`
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
    if (!content.payload.component) content.payload.component = [];
    for (const [name, body] of handlers.entries()) {
      content.payload.component.push({ reference: name, value: body });
    }
  }

  const templateComponentResult = await pool.query(`
    SELECT c.name, c.payload 
    FROM Components c
    JOIN TemplateComponents tc ON c.id = tc.component_id
    WHERE tc.template_id = $1
  `, [resolvedTemplateId]);

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
      content.payload.component.push({ reference: name, value: payload });
    }
  }

  // Dynamic Editor Component Injection
  if (editorMode) {
    const tagCheck = await pool.query(`
      SELECT 1 FROM TemplateTags tt
      JOIN Tags tag ON tt.tag_id = tag.id
      JOIN Templates t ON tt.template_id = t.id
      JOIN Templates rt ON t.group_id = rt.group_id
      WHERE rt.id = $1 AND tag.name = 'editor'
    `, [resolvedTemplateId]);

    const hasEditorTag = tagCheck.rows.length > 0;

    const injectInspectHandlers = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.component && node.component.some((c: any) => c.reference === "PreemptEditor")) return;
      
      const hasClickHandler = node.handlers?.click || node.handlers?.onclick;
      const hasComponentClickHandler = node.component?.some((c: any) => c.target === "handlers.click" || c.target === "handlers.onclick");
      
      if (!hasClickHandler && !hasComponentClickHandler) {
        if (!node.component) node.component = [];
        node.component.push({ reference: "EditorInspectHandler", target: "handlers.click" });
      }

      if (Array.isArray(node.content)) {
        node.content.forEach(injectInspectHandlers);
      } else if (typeof node.content === 'object') {
        injectInspectHandlers(node.content);
      }
    };

    if (content.template_payload?.content) {
      if (Array.isArray(content.template_payload.content)) {
        content.template_payload.content.forEach(injectInspectHandlers);
      } else {
        injectInspectHandlers(content.template_payload.content);
      }
    }
    
    if (content.payload?.content) {
      if (Array.isArray(content.payload.content)) {
        content.payload.content.forEach(injectInspectHandlers);
      } else {
        injectInspectHandlers(content.payload.content);
      }
    }

    if (!hasEditorTag) {
      if (!content.template_payload.content) content.template_payload.content = [];
      if (!Array.isArray(content.template_payload.content)) {
        content.template_payload.content = [content.template_payload.content];
      }
      content.template_payload.content.push({
        type: "div",
        component: [
          { reference: "PreemptEditor", target: "type" },
          { reference: "editorMode", target: "props.mode", value: editorMode }
        ]
      });

      const editorComponentRes = await pool.query(`SELECT payload FROM Components WHERE name = 'PreemptEditor'`);
      if (editorComponentRes.rows.length > 0) {
        if (!content.payload.component) content.payload.component = [];
        content.payload.component.push({
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
        content.payload.component.push({
          reference: h.name,
          value: h.body
        });
      });
    }
  }

  return content;
}

export async function getLatestContent(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}) {
  let query = `
    SELECT c.* 
    FROM Content c
  `;
  const params: any[] = [];
  const conditions: string[] = [];
  
  if (criteria.tags && criteria.tags.length > 0) {
    for (const tag of criteria.tags) {
      params.push(tag);
      conditions.push(`EXISTS (
        SELECT 1 FROM ContentTags ct
        JOIN Tags t ON ct.tag_id = t.id
        WHERE ct.content_id = c.id AND t.name = $${params.length}
      )`);
    }
  }

  if (criteria.author) {
    params.push(criteria.author);
    conditions.push(`c.author_id = $${params.length}`);
  }
  
  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(' AND ');
  }

  query += ` ORDER BY c.created_at DESC`;
  
  const limit = criteria.limit || 10;
  params.push(limit);
  query += ` LIMIT $${params.length}`;
  
  const offset = criteria.offset || 0;
  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getContentCount(criteria: { tags?: string[]; author?: string } = {}) {
  let query = `
    SELECT COUNT(*) as count 
    FROM Content c
  `;
  const params: any[] = [];
  const conditions: string[] = [];
  
  if (criteria.tags && criteria.tags.length > 0) {
    for (const tag of criteria.tags) {
      params.push(tag);
      conditions.push(`EXISTS (
        SELECT 1 FROM ContentTags ct
        JOIN Tags t ON ct.tag_id = t.id
        WHERE ct.content_id = c.id AND t.name = $${params.length}
      )`);
    }
  }

  if (criteria.author) {
    params.push(criteria.author);
    conditions.push(`c.author_id = $${params.length}`);
  }
  
  if (conditions.length > 0) {
    query += ` WHERE ` + conditions.join(' AND ');
  }

  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count, 10);
}
