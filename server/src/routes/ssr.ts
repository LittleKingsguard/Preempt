import express from "express";
import { pool } from "../db.js";
import path from "path";
import fs from "fs";

const router = express.Router();

router.get("/content/:id", async (req, res) => {
  const contentId = parseInt(req.params.id, 10);
  try {
    const result = await pool.query("SELECT headers FROM Content WHERE id = $1", [contentId]);
    if (result.rows.length === 0) {
      return res.status(404).send("Content not found");
    }
    const headers = result.rows[0].headers || "";

    const distPath = path.join(process.cwd(), "../dist/index.html");
    if (!fs.existsSync(distPath)) {
      return res.status(500).send("Frontend dist not found. Did you run npm run build?");
    }

    let html = fs.readFileSync(distPath, "utf-8");
    html = html.replace("<!-- HEADERS_INJECT -->", headers);
    
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

export default router;
