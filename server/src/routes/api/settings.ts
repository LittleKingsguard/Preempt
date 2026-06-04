import express from "express";
import { authenticateToken } from "../../middleware/auth.js";
import { setSetting } from "../../models/settings.js";

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
    await setSetting('default_index_content_id', { id: contentId });
    res.json({ message: "Default index updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
