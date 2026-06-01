import express from "express";
import { getContentWithTemplate, getLatestContent, getContentCount } from "../models/content.js";
import { getSetting } from "../models/settings.js";
import { Supervisor } from "../../../src/core/Supervisor.js";
import path from "path";
import fs from "fs";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();


const serverApi = {
  getLatestContent,
  getContentCount
};

async function renderContent(contentId: number, editorMode: string | null, req: any, res: any) {
  if (editorMode) {
    const user = req.user;
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
    let serverConfig = {
      runInstantiation: false,
      runAssembly: false,
      runPreprocessing: false,
      runValidation: false,
      runRendering: false,
      runPostprocessing: false,
      runMonitoring: false
    };

    let dbConfig = await getSetting('server_config');
    if (dbConfig) {
      if (typeof dbConfig === 'string') {
        try { dbConfig = JSON.parse(dbConfig); } catch (e) {}
      }
      if (typeof dbConfig === 'object') {
        serverConfig = { ...serverConfig, ...dbConfig };
      }
    }

    const htmlOutput = await Supervisor.process(contentData.template_payload, contentData.payload, serverConfig, serverApi);

    let html = fs.readFileSync(distPath, "utf-8");

    const clientConfig = {
      runInstantiation: true,
      runAssembly: !serverConfig.runAssembly,
      runPreprocessing: !serverConfig.runPreprocessing,
      runValidation: !serverConfig.runValidation,
      runRendering: true, // Required for hydration
      runPostprocessing: !serverConfig.runPostprocessing,
      runMonitoring: true
    };

    const payloadScript = `<script id="preempt-initial-data" type="application/json">${JSON.stringify({
      template: contentData.template_payload,
      content: contentData.payload,
      clientConfig: clientConfig
    })}</script>`;

    const headersInject = (contentData.headers || "") + "\n" + payloadScript;
    html = html.replace("<!-- HEADERS_INJECT -->", headersInject);

    html = html.replace('<div id="app"></div>', `<div id="app">${htmlOutput || ""}</div>`);

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
}

router.get("/", authenticateToken, async (req, res) => {
  try {
    const setting = await getSetting('default_index_content_id');
    const defaultIndexId = (setting && setting.id) ? setting.id : null;
    
    if (!defaultIndexId) {
      return res.status(404).send("No default index configured");
    }

    await renderContent(defaultIndexId, null, req, res);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

router.get("/content/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const editorMode = req.query.editorMode as string || null;
  await renderContent(contentId, editorMode, req, res);
});

export default router;
