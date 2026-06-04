import express from "express";
import { getTags } from "../../models/tag.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getTags());
});

export default router;
