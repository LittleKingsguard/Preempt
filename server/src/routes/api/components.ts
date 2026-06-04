import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { getComponents, getComponentById, createComponent, updateComponent, deleteComponent } from "../../models/component.js";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const components = await getComponents();
    res.json(components);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  try {
    const component = await getComponentById(componentId);
    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }
    res.json(component);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const authErr = validateUserRoles(user, ["admin", "contributor"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ id: 999999, name: req.body.name || "", payload: req.body.payload || {} });
  const { name, payload } = req.body;
  if (!name || !payload) return res.status(400).json({ error: "Name and payload are required" });

  try {
    const result = await createComponent(user, name, payload);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  
  const component = await getComponentById(componentId);
  if (!component) return res.status(404).json({ error: "Component not found" });
  const authorUsername = component.author_id;

  const authErr = validateUserRoles(user, ["admin", "author"], authorUsername);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ id: componentId, name: req.body.name || "", payload: req.body.payload || {} });
  const { name, payload } = req.body;
  if (!name || !payload) return res.status(400).json({ error: "Name and payload are required" });

  try {
    const result = await updateComponent(componentId, user, name, payload);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const componentId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  const component = await getComponentById(componentId);
  if (!component) return res.status(404).json({ error: "Component not found" });
  const authorUsername = component.author_id;

  const authErr = validateUserRoles(user, ["admin", "author"], authorUsername);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ message: "Component deleted successfully" });

  try {
    const result = await deleteComponent(componentId, user);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ message: "Component deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
