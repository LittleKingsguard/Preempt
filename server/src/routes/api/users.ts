import { Router } from 'express';
import { User } from '../../models/user.js';
import { pgUserSource } from '../../sources/userSource.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  const format = req.query.format === 'content' ? 'content' : 'raw';
  try {
    const users = await User.getAll(pgUserSource, { format });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get('/:username', authenticateToken, async (req, res) => {
  const format = req.query.format === 'content' ? 'content' : 'raw';
  const username = req.params.username as string;
  try {
    const user = await User.getByUsername(pgUserSource, username, { format });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (format === 'content') {
      res.json(user);
    } else {
      res.json({ username: user.username, role: user.role, home_page: user.home_page });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
