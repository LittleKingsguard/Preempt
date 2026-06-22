import { logger } from "../../utils/logger.js";
import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { Component } from "../../models/component.js";
import { pgComponentSource } from "../../sources/componentSource.js";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const components = await Component.getAll(pgComponentSource, (req as any).user);
    res.json(components);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  try {
    const component = await Component.getById(pgComponentSource, componentId);
    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }
    const user = (req as any).user;
    const authErr = validateUserRoles(user, component.approved_roles || [], component.author_id);
    if (authErr) return res.status(authErr.status).json({ error: authErr.error });

    res.json(component);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const { name, payload } = req.body;

  try {
    const result = await Component.create(pgComponentSource, user, { name, payload });
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { name, payload } = req.body;

  try {
    const component = await Component.getById(pgComponentSource, componentId);
    if (!component) return res.status(404).json({ error: "Component not found" });

    const result = await component.update(user, { name, payload });
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
  const componentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  try {
    const component = await Component.getById(pgComponentSource, componentId);
    if (!component) return res.status(404).json({ error: "Component not found" });

    const result = await component.delete(user);
    if ('error' in result) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Component deleted successfully" });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
