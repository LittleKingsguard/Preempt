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

export default router;
