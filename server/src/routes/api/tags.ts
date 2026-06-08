import express from "express";
import { Tag } from "../../models/tag.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json(Tag.getTags());
});

export default router;
