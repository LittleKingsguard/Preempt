import express from "express";
import { authenticateToken, requireAdmin } from "../../middleware/auth.js";
import { User } from "../../models/user.js";

const router = express.Router();

router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.getAll();
    res.json(users);
  } catch (err) {
    console.error(err);
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

    const user = await User.getByUsername(username as string);
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.updateRoles({ is_contributor, is_bot, is_shadowed });
    res.json({ success: true, message: "User roles updated successfully" });
  } catch (err: any) {
    console.error(err);
    if (err.code === '23514' && err.constraint === 'check_bot_roles') {
      return res.status(400).json({ error: "A bot cannot have admin or contributor roles" });
    }
    if (err.code === '23514' && err.constraint === 'check_verified_roles') {
      return res.status(400).json({ error: "User must verify their email before receiving admin or contributor roles" });
    }
    res.status(500).json({ error: "Failed to update user roles" });
  }
});

export default router;
