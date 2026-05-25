import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { getTags } from "../models/tag.js";
import { getTemplateById, createTemplate, updateTemplate } from "../models/template.js";
import { getContentWithTemplate } from "../models/content.js";
import { getHandlers, createHandler, updateHandler } from "../models/handler.js";

const router = express.Router();

router.get("/tags", (req, res) => {
  res.json(getTags());
});

router.get("/handlers", authenticateToken, async (req, res) => {
  try {
    const handlers = await getHandlers();
    res.json(handlers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/handlers", authenticateToken, async (req, res) => {
  // TODO: For production release, create a .d.ts file to extend express.Request with user property
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!user.is_admin) return res.status(403).json({ error: "Forbidden: Only admins can create handlers" });

  const { name, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "Name and body are required" });

  try {
    const result = await createHandler(user, name, body);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/handlers/:id", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!user.is_admin) return res.status(403).json({ error: "Forbidden: Only admins can update handlers" });

  const { name, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "Name and body are required" });

  try {
    const result = await updateHandler(handlerId, user, name, body);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/content/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const templateId = req.query.templateId ? parseInt(req.query.templateId as string, 10) : null;
  const tagsParam = req.query.tags as string;
  const user = (req as any).user;

  try {
    const content = await getContentWithTemplate(contentId, templateId, tagsParam);

    if (!content) {
      return res.status(404).json({ error: "Content or associated Template not found" });
    }

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
    const template = await getTemplateById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json(template);
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
    const template = await createTemplate(user.username, payload, tags);
    res.json({ message: "Template created successfully", template });
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
    const result = await updateTemplate(templateId, user.username, user.is_admin, payload, tags);
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
