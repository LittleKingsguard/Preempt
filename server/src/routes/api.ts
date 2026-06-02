import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { getTags } from "../models/tag.js";
import { getTemplateById, createTemplate, updateTemplate } from "../models/template.js";
import { getContentWithTemplate } from "../models/content.js";
import { getHandlers, createHandler, updateHandler } from "../models/handler.js";
import { getComponents, getComponentById, createComponent, updateComponent, deleteComponent } from "../models/component.js";
import { setSetting } from "../models/settings.js";

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
  const editorMode = req.query.editorMode as string || null;
  const user = (req as any).user;

  if (editorMode) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return res.status(403).json({ error: "Forbidden: Must be admin or contributor to use edit mode" });
    }
  }

  try {
    const content = await getContentWithTemplate(contentId, templateId, tagsParam, editorMode);

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
  const editorMode = req.query.editorMode as string || null;
  const user = (req as any).user;

  if (editorMode) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return res.status(403).json({ error: "Forbidden: Must be admin or contributor to use edit mode" });
    }
  }

  try {
    const template = await getTemplateById(templateId, editorMode);
    
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
    const result = await createTemplate(user.username, payload, tags);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Template created successfully", template: result.template });
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

router.get("/components", authenticateToken, async (req, res) => {
  try {
    const components = await getComponents();
    res.json(components);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/components/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  try {
    const component = await getComponentById(componentId);
    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }
    res.json(component);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/components", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const { name, payload } = req.body;
  if (!name || !payload) return res.status(400).json({ error: "Name and payload are required" });

  try {
    const result = await createComponent(user, name, payload);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/components/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { name, payload } = req.body;
  if (!name || !payload) return res.status(400).json({ error: "Name and payload are required" });

  try {
    const result = await updateComponent(componentId, user, name, payload);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/components/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  try {
    const result = await deleteComponent(componentId, user);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Component deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/default-index", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: "Forbidden: Only admins can set the default index" });
  }

  const { contentId } = req.body;
  if (!contentId || typeof contentId !== 'number') {
    return res.status(400).json({ error: "Valid contentId is required" });
  }

  try {
    // Invalidate memory cache across SSR instances (in a real production app we'd use a shared cache or pubsub, but here we can just update the DB. We'll update the global cache variable if it exists in ssr.ts later).
    await setSetting('default_index_content_id', { id: contentId });
    // Also broadcast an event to invalidate the cache if possible, or we will handle it in ssr.ts using a getter.
    res.json({ message: "Default index updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
