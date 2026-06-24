import { Router } from 'express';
import { User } from '../../models/user.js';
import { pgUserSource } from '../../sources/userSource.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = Router();

router.get('/:username', authenticateToken, async (req, res) => {
  const username = req.params.username as string;
  try {
    const user = await User.getByUsername(pgUserSource, username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    // Only return public info
    res.json({ username: user.username, role: user.role, home_page: user.home_page });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
