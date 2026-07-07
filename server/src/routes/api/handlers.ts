import { logger } from "../../utils/logger.js";
import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { Handler } from "../../models/handler.js";
import { pgHandlerSource } from "../../sources/handlerSource.js";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  const format = req.query.format === 'content' ? 'content' : 'raw';
  const name = typeof req.query.name === 'string' ? req.query.name : undefined;
  try {
    const handlers = await Handler.getAll(pgHandlerSource, (req as any).user, {
      format,
      ...(name ? { name } : {})
    });
    res.json(handlers);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const { name, body } = req.body;

  try {
    const result = await Handler.create(pgHandlerSource, user, { name, body });
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const format = req.query.format === 'content' ? 'content' : 'raw';
  try {
    const handler = await Handler.getById(pgHandlerSource, handlerId, { format });
    if (!handler) return res.status(404).json({ error: "Handler not found" });
    res.json(handler);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { name, body } = req.body;

  try {
    const handler = await Handler.getById(pgHandlerSource, handlerId);
    if (!handler) return res.status(404).json({ error: "Handler not found" });

    const result = await handler.update(user, { name, body });
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  try {
    const handler = await Handler.getById(pgHandlerSource, handlerId);
    if (!handler) return res.status(404).json({ error: "Handler not found" });

    const result = await handler.delete(user);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id/approve", authenticateToken, async (req, res) => {
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { is_approved } = req.body;

  try {
    const handler = await Handler.getById(pgHandlerSource, handlerId);
    if (!handler) return res.status(404).json({ error: "Handler not found" });

    const result = await handler.approve(user, is_approved);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
