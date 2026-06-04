import express from "express";
import { authenticateToken, validateUserRoles } from "../../middleware/auth.js";
import { getHandlers, createHandler, updateHandler, deleteHandler, approveHandler } from "../../models/handler.js";
import { pool } from "../../db.js";

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const handlers = await getHandlers();
    res.json(handlers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const user = (req as any).user;
  const authErr = validateUserRoles(user, ["admin", "contributor", "trusted_dev"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ id: 999999, name: req.body.name || "", body: req.body.body || "" });

  const { name, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "Name and body are required" });

  try {
    const result = await createHandler(user, name, body);
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
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  
  const result = await pool.query("SELECT author_id FROM Handlers WHERE id = $1", [handlerId]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Handler not found" });
  const authorUsername = result.rows[0].author_id;

  const authErr = validateUserRoles(user, ["admin", "author"], authorUsername);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ id: handlerId, name: req.body.name || "", body: req.body.body || "" });

  const { name, body } = req.body;
  if (!name || !body) return res.status(400).json({ error: "Name and body are required" });

  try {
    const result = await updateHandler(handlerId, user, name, body);
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
  const handlerId = parseInt(req.params.id as string, 10);
  const user = (req as any).user;

  const result = await pool.query("SELECT author_id FROM Handlers WHERE id = $1", [handlerId]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Handler not found" });
  const authorUsername = result.rows[0].author_id;

  const authErr = validateUserRoles(user, ["admin", "author"], authorUsername);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ message: "Handler deleted successfully" });

  try {
    const result = await deleteHandler(handlerId, user);
    if (result.error) {
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
  
  const authErr = validateUserRoles(user, ["admin", "trusted_dev"]);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (user.is_shadowed) return res.json({ message: "Handler approval status updated successfully" });

  const { is_approved } = req.body;
  if (typeof is_approved !== 'boolean') return res.status(400).json({ error: "is_approved boolean is required" });

  try {
    const result = await approveHandler(handlerId, user, is_approved);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
