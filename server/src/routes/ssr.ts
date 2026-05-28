import express from "express";
import { getContentWithTemplate } from "../models/content.js";
import { Supervisor } from "../../../src/core/Supervisor.js";
import path from "path";
import fs from "fs";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

router.get("/content/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const editorMode = req.query.editorMode as string || null;

  if (editorMode) {
    const user = (req as any).user;
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return res.status(403).send("Forbidden: Must be admin or contributor to use edit mode");
    }
  }

  try {
    const contentData = await getContentWithTemplate(contentId, null, null, editorMode);
    if (!contentData) {
      return res.status(404).send("Content not found");
    }

    const distPath = path.join(process.cwd(), "../dist/index.html");
    if (!fs.existsSync(distPath)) {
      return res.status(500).send("Frontend dist not found. Did you run npm run build?");
    }

    Supervisor.resetInstantiation();
    const htmlOutput = await Supervisor.process(contentData.template_payload, contentData.payload, {
      runInstantiation: true,
      runAssembly: true,
      runPreprocessing: true,
      runValidation: true,
      runRendering: true,
      runPostprocessing: false,
      runMonitoring: false
    });

    let html = fs.readFileSync(distPath, "utf-8");
    
    const payloadScript = `<script id="preempt-initial-data" type="application/json">${JSON.stringify({
      template: contentData.template_payload,
      content: contentData.payload,
      clientConfig: {
        runInstantiation: true, // Always true as requested
        runAssembly: true,
        runPreprocessing: true,
        runValidation: true,
        runRendering: true,
        runPostprocessing: true,
        runMonitoring: true
      }
    })}</script>`;
    
    const headersInject = (contentData.headers || "") + "\n" + payloadScript;
    html = html.replace("<!-- HEADERS_INJECT -->", headersInject);
    
    html = html.replace('<div id="app"></div>', `<div id="app">${htmlOutput || ""}</div>`);
    
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

export default router;
