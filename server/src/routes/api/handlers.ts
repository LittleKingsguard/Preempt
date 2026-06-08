import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { Handler } from "../../models/handler.js";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const handlers = await Handler.getAll((req as any).user);
    res.json(handlers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const { name, body } = req.body;

  try {
    const result = await Handler.create(user, { name, body });
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { name, body } = req.body;

  try {
    const handler = await Handler.getById(handlerId);
    if (!handler) return res.status(404).json({ error: "Handler not found" });

    const result = await handler.update(user, { name, body });
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  try {
    const handler = await Handler.getById(handlerId);
    if (!handler) return res.status(404).json({ error: "Handler not found" });

    const result = await handler.delete(user);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id/approve", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { is_approved } = req.body;

  try {
    const handler = await Handler.getById(handlerId);
    if (!handler) return res.status(404).json({ error: "Handler not found" });

    const result = await handler.approve(user, is_approved);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
