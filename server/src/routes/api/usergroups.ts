import express from 'express';
import { UserGroup } from '../../models/userGroup.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  const format = req.query.format === 'content' ? 'content' : 'raw';
  try {
    const groups = await UserGroup.getAll(undefined, { format });
    res.json(groups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const result = await UserGroup.create((req as any).user, name);
    if ('error' in result) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const group = await UserGroup.getById(parseInt(req.params.id as string, 10));
    if ('error' in group) {
      return res.status(group.status || 404).json({ error: group.error });
    }
    const result = await group.delete((req as any).user);
    if ('error' in result) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.json({ message: "Group deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const group = await UserGroup.getById(parseInt(req.params.id as string, 10));
    if ('error' in group) {
      return res.status(group.status || 404).json({ error: group.error });
    }
    const members = await group.getMembers();
    res.json(members);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    const group = await UserGroup.getById(parseInt(req.params.id as string, 10));
    if ('error' in group) {
      return res.status(group.status || 404).json({ error: group.error });
    }
    const result = await group.addMember((req as any).user, username);
    if ('error' in result) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/members/:username', authenticateToken, async (req, res) => {
  try {
    const group = await UserGroup.getById(parseInt(req.params.id as string, 10));
    if ('error' in group) {
      return res.status(group.status || 404).json({ error: group.error });
    }
    const result = await group.removeMember((req as any).user, req.params.username as string);
    if ('error' in result) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.json({ message: "Member removed successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
