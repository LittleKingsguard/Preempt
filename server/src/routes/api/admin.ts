import { logger } from "../../utils/logger.js";
import express from "express";
import { authenticateToken, requireAdmin } from "../../middleware/auth.js";
import { User } from "../../models/user.js";
import { pgUserSource } from "../../sources/userSource.js";

const router = express.Router();

router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.getAll(undefined);
    res.json(users);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.put("/users/:username/roles", authenticateToken, requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { is_contributor, is_bot, is_shadowed } = req.body;

  try {
    if (is_bot && is_contributor) {
      return res.status(400).json({ error: "A user cannot be both a bot and a contributor" });
    }

    const user = await User.getByUsername(pgUserSource, username as string);
    if (!user || ('error' in user)) return res.status(user.status || 404).json(user);
    const result = await user.updateRoles({ is_contributor, is_bot, is_shadowed });
    if (result && 'error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ success: true, message: "User roles updated successfully" });
  } catch (err: any) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Failed to update user roles" });
  }
});

export default router;
