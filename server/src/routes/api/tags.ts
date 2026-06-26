import express from "express";
import { Tag } from "../../models/tag.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const format = req.query.format === 'content' ? 'content' : 'raw';
  const tags = await Tag.getTags(undefined, { format });
  res.json(tags);
});

export default router;
