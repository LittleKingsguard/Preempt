import { logger } from "../../utils/logger.js";
import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { Template } from "../../models/template.js";
import { pgTemplateSource } from "../../sources/templateSource.js";

const router = express.Router();

router.get("/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  try {
    const result = await Template.getById(pgTemplateSource, templateId, null, user);
    
    if (result && 'error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    if (result && 'template' in result) {
      res.json(result.template);
    }
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const authErr = validateUserRoles(user, ["admin", "contributor"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ message: "Template created successfully", template: { id: 999999, username: user.username, payload: req.body.payload, tags: req.body.tags } });

  const { payload, tags, groupId } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const result = await Template.create(pgTemplateSource, user.username, payload, tags, groupId);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Template created successfully", template: result.template });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ message: "Template updated successfully", template: { id: templateId, username: user.username, payload: req.body.payload, tags: req.body.tags } });

  const { payload, tags, groupId } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const getRes = await Template.getById(pgTemplateSource, templateId, null, user);
    if ('error' in getRes) return res.status(getRes.status || 404).json({ error: getRes.error });

    const template = getRes.template!;
    const result = await template.update(user, payload, tags, groupId);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ message: "Template updated successfully", template: result.template });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
