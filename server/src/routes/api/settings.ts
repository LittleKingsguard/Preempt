import { logger } from "../../utils/logger.js";
import express from "express";
import { authenticateToken } from "../../middleware/auth.js";
import { Setting } from "../../models/settings.js";
import { pgSettingSource } from "../../sources/settingsSource.js";

const router = express.Router();

router.post("/default-index", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: "Forbidden: Only admins can set the default index" });
  }

  const { contentId } = req.body;
  if (!contentId || typeof contentId !== 'number') {
    return res.status(400).json({ error: "Valid contentId is required" });
  }

  try {
    const result = await Setting.set(pgSettingSource, 'default_index_content_id', { id: contentId });
    if (result && 'error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Default index updated successfully" });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/aliases", authenticateToken, async (req, res) => {
  try {
    const aliases = await Setting.get(pgSettingSource, 'page_aliases') || {};
    res.json(aliases);
  } catch (err) {
    logger.error({ err }, "Failed to fetch aliases");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/aliases", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: "Forbidden: Only admins can modify aliases" });
  }

  const payload = req.body;
  if (!Array.isArray(payload)) {
    return res.status(400).json({ error: "Payload must be an array of alias modifications" });
  }

  const pathRegex = /^\/[a-zA-Z0-9_\-\/]+$/;

  try {
    const currentAliases = await Setting.get(pgSettingSource, 'page_aliases') || {};

    for (const mod of payload) {
      const { path, contentId } = mod;
      
      if (typeof path !== 'string' || !pathRegex.test(path)) {
        return res.status(400).json({ error: `Invalid alias path: ${path}. Must start with '/' and contain only alphanumeric characters, '_', '-', or '/'` });
      }

      if (contentId === null) {
        delete currentAliases[path];
      } else if (typeof contentId === 'number') {
        currentAliases[path] = contentId;
      } else {
        return res.status(400).json({ error: `Invalid contentId for path ${path}: must be a number or null` });
      }
    }

    const result = await Setting.set(pgSettingSource, 'page_aliases', currentAliases);
    if (result && 'error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ message: "Aliases updated successfully", aliases: currentAliases });
  } catch (err) {
    logger.error({ err }, "An error occurred updating aliases");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
