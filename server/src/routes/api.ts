import express from "express";
import { pool } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { getTags, updateTemplateTags } from "../utils/tags.js";

const router = express.Router();

router.get("/tags", (req, res) => {
  res.json(getTags());
});

router.get("/content/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const templateId = req.query.templateId ? parseInt(req.query.templateId as string, 10) : null;
  const tagsParam = req.query.tags as string;
  const user = (req as any).user;

  try {
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

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Content or associated Template not found" });
    }

    const content = result.rows[0];

    // Access Control
    const isAuthor = user?.username === content.author_id;
    const isAdmin = user?.is_admin === true;
    const now = new Date();

    if (!isAuthor && !isAdmin) {
      if (!content.is_visible) {
        return res.status(403).json({ error: "Forbidden: Content is not visible" });
      }
      if (content.live_date && new Date(content.live_date) > now) {
        return res.status(403).json({ error: "Forbidden: Content is not live yet" });
      }
    }

    res.json({
      template: content.template_payload,
      content: content.payload
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/template/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);

  try {
    const result = await pool.query("SELECT * FROM Templates WHERE id = $1", [templateId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/template", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!user.is_admin && !user.is_contributor) {
    return res.status(403).json({ error: "Forbidden: Must be contributor or admin" });
  }

  const { payload, tags } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        "INSERT INTO Templates (author_id, payload) VALUES ($1, $2) RETURNING *",
        [user.username, payload]
      );
      const template = result.rows[0];
      if (tags && Array.isArray(tags)) {
        await updateTemplateTags(client, template.id, tags);
      }
      await client.query('COMMIT');
      res.json({ message: "Template created successfully", template });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/template/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!user.is_admin && !user.is_contributor) {
    return res.status(403).json({ error: "Forbidden: Must be contributor or admin" });
  }

  const { payload, tags } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Check ownership
      const check = await client.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: "Template not found" });
      }

      if (check.rows[0].author_id !== user.username && !user.is_admin) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({ error: "Forbidden: Not the author" });
      }

      const result = await client.query(
        "UPDATE Templates SET payload = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        [payload, templateId]
      );
      if (tags && Array.isArray(tags)) {
        await updateTemplateTags(client, templateId, tags);
      }
      await client.query('COMMIT');
      res.json({ message: "Template updated successfully", template: result.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
