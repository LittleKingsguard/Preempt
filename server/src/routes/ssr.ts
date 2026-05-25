import express from "express";
import { getContentHeaders } from "../models/content.js";
import path from "path";
import fs from "fs";

const router = express.Router();

router.get("/content/:id", async (req, res) => {
  const contentId = parseInt(req.params.id, 10);
  try {
    const headers = await getContentHeaders(contentId);
    if (headers === null) {
      return res.status(404).send("Content not found");
    }

    const distPath = path.join(process.cwd(), "../dist/index.html");
    if (!fs.existsSync(distPath)) {
      return res.status(500).send("Frontend dist not found. Did you run npm run build?");
    }

    let html = fs.readFileSync(distPath, "utf-8");
    html = html.replace("<!-- HEADERS_INJECT -->", headers || "");
    
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

export default router;
