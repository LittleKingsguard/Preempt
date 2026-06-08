import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { Content } from "../../models/content.js";

const router = express.Router();

router.get("/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const templateId = req.query.templateId ? parseInt(req.query.templateId as string, 10) : null;
  const clientTemplateId = req.query.clientTemplateId ? parseInt(req.query.clientTemplateId as string, 10) : null;
  const tagsParam = req.query.tags as string;
  const user = (req as any).user;

  try {
    let contentRes = null;
    
    if (clientTemplateId) {
      contentRes = await Content.getWithTemplate(contentId, clientTemplateId, null, null, user);
    }
    
    if (!contentRes || 'error' in contentRes) {
      contentRes = await Content.getWithTemplate(contentId, templateId, tagsParam, null, user);
    }

    if (!contentRes || 'error' in contentRes) {
      return res.status((contentRes as any)?.status || 404).json({ error: (contentRes as any)?.error || "Content or associated Template not found" });
    }

    const contentData = (contentRes as any).content;
    const responsePayload: any = {
      content: contentData.payload
    };
    if (contentData.headers) {
      responsePayload.headers = contentData.headers;
    }

    if (clientTemplateId !== contentData.resolved_template_id) {
      responsePayload.template = contentData.template_payload;
      responsePayload.templateId = contentData.resolved_template_id;
    }

    res.json(responsePayload);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const authErr = validateUserRoles(user, ["admin", "contributor"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  try {
    const contents = await Content.getLatest();
    res.json(contents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ message: "Content created successfully", content: { id: 999999, ...req.body } });

  const { payload, headers, tags, groupIds, isVisible, liveDate } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const result = await Content.create(user, payload, headers, tags, groupIds, isVisible, liveDate);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Content created successfully", content: result.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ message: "Content updated successfully", content: { id: contentId, ...req.body } });

  const { payload, headers, tags, groupIds, isVisible, liveDate } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const content = await Content.getById(contentId);
    if (!content) return res.status(404).json({ error: "Content not found" });

    const result = await content.update(user, payload, headers, tags, groupIds, isVisible, liveDate);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Content updated successfully", content: result.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ success: true });

  try {
    const content = await Content.getById(contentId);
    if (!content) return res.status(404).json({ error: "Content not found" });

    const result = await content.delete(user);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
