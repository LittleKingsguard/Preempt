import { logger } from "../../utils/logger.js";
import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { Content } from "../../models/content.js";
import { pgContentSource } from "../../sources/contentSource.js";
import { pgTemplateSource } from "../../sources/templateSource.js";
import { PreemptEvent } from "../../../../src/types/Event.js";

const router = express.Router();

router.get("/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const templateId = req.query.templateId ? parseInt(req.query.templateId as string, 10) : null;
  const clientTemplateId = req.query.clientTemplateId ? parseInt(req.query.clientTemplateId as string, 10) : null;
  const tagsParam = req.query.tags as string;
  const format = req.query.format === 'raw' ? 'raw' : 'content';
  const user = (req as any).user;

  try {
    if (format === 'raw') {
      const rows = await pgContentSource.get(new PreemptEvent('content.get', { id: 'system', type: 'process' }), { id: contentId }, user);
      if (!rows || rows.length === 0 || 'error' in rows) {
        return res.status(404).json({ error: "Content not found" });
      }
      return res.json(rows[0]);
    }

    let contentRes = null;
    
    if (clientTemplateId) {
      contentRes = await Content.getWithTemplate(pgContentSource, pgTemplateSource, contentId, clientTemplateId, null, null, user);
    }
    
    if (!contentRes || 'error' in contentRes) {
      contentRes = await Content.getWithTemplate(pgContentSource, pgTemplateSource, contentId, templateId, tagsParam, null, user);
    }

    if (!contentRes || 'error' in contentRes) {
      return res.status((contentRes as any)?.status || 404).json({ error: (contentRes as any)?.error || "Content or associated Template not found" });
    }

    const contentData = (contentRes as any).content;
    const responsePayload: any = {
      content: contentData.payload,
      metadata: contentData.metadata
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
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", authenticateToken, async (req, res) => {
  const format = req.query.format === 'raw' ? 'raw' : 'content';
  const user = (req as any).user;
  const authErr = validateUserRoles(user, ["admin", "contributor"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const tagsParam = req.query.tags as string;
  const criteria: any = {};
  if (tagsParam) {
    criteria.tags = tagsParam.split(',').map(t => t.trim()).filter(t => t);
  }

  try {
    if (format === 'raw') {
      const rows = await pgContentSource.get(new PreemptEvent('content.get', { id: 'system', type: 'process' }), criteria, user);
      return res.json(rows);
    }
    const contents = await Content.getLatest(pgContentSource, criteria, user);
    res.json(contents);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ message: "Content created successfully", content: { id: 999999, ...req.body } });

  const { payload, headers, tags, groupIds, isVisible, liveDate, promo } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const result = await Content.create(pgContentSource, user, payload, headers, tags, groupIds, isVisible, liveDate, promo);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Content created successfully", content: result.content });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ message: "Content updated successfully", content: { id: contentId, ...req.body } });

  const { payload, headers, tags, groupIds, isVisible, liveDate, promo } = req.body;
  if (!payload) return res.status(400).json({ error: "Payload is required" });

  try {
    const content = await Content.getById(pgContentSource, contentId, user);
    if (!content) return res.status(404).json({ error: "Content not found" });

    const result = await content.update(user, payload, headers, tags, groupIds, isVisible, liveDate, promo);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Content updated successfully", content: result.content });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.is_shadowed) return res.json({ success: true });

  try {
    const content = await Content.getById(pgContentSource, contentId, user);
    if (!content) return res.status(404).json({ error: "Content not found" });

    const result = await content.delete(user);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/users", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { username, role } = req.body;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!username || !role) return res.status(400).json({ error: "Username and role are required" });

  try {
    const content = await Content.getById(pgContentSource, contentId, user);
    if (!content || 'error' in content) return res.status(404).json({ error: "Content not found" });

    const result = await content.addRole(user, username, role);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/users/:username", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const targetUsername = req.params.username;

  if (!user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const content = await Content.getById(pgContentSource, contentId, user);
    if (!content || 'error' in content) return res.status(404).json({ error: "Content not found" });

    const result = await content.removeRole(user, targetUsername);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});
router.post("/:id/groups", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { groupId, role } = req.body;

  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!groupId || !role) return res.status(400).json({ error: "GroupId and role are required" });

  try {
    const content = await Content.getById(pgContentSource, contentId, user);
    if (!content || 'error' in content) return res.status(404).json({ error: "Content not found" });

    const result = await content.addGroupRole(user, parseInt(groupId, 10), role);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/groups/:groupId", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const targetGroupId = parseInt(req.params.groupId as string, 10);

  if (!user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const content = await Content.getById(pgContentSource, contentId, user);
    if (!content || 'error' in content) return res.status(404).json({ error: "Content not found" });

    const result = await content.removeGroupRole(user, targetGroupId);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});
export default router;
