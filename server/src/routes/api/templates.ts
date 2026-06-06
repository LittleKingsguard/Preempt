import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { getTemplateById, createTemplate, updateTemplate } from "../../models/template.js";
import { pool } from "../../db.js";

const router = express.Router();

router.get("/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  try {
    const result = await getTemplateById(templateId, null, user);
    
    if (result && 'error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    if (result && 'template' in result) {
      res.json(result.template);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const authErr = validateUserRoles(user, ["admin", "contributor"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ message: "Template created successfully", template: { id: 999999, username: user.username, payload: req.body.payload, tags: req.body.tags } });

  const { payload, tags, groupId } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const result = await createTemplate(user.username, payload, tags, groupId);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Template created successfully", template: result.template });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  const result = await pool.query("SELECT author_id FROM Templates WHERE id = $1", [templateId]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Template not found" });
  const authorUsername = result.rows[0].author_id;

  const authErr = validateUserRoles(user, ["admin", "author"], authorUsername);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ message: "Template updated successfully", template: { id: templateId, username: user.username, payload: req.body.payload, tags: req.body.tags } });

  const { payload, tags, groupId } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const result = await updateTemplate(templateId, user.username, user.is_admin, payload, tags, groupId);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ message: "Template updated successfully", template: result.template });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
