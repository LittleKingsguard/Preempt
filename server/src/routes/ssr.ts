import { logger } from "../utils/logger.js";
import express from "express";
import { Content } from "../models/content.js";
import { User } from "../models/user.js";
import { pgContentSource } from "../sources/contentSource.js";
import { pgTemplateSource } from "../sources/templateSource.js";
import { pgSettingSource } from "../sources/settingsSource.js";
import { pgUserSource } from "../sources/userSource.js";
import { Setting } from "../models/settings.js";
import { Supervisor } from "../../../src/core/Supervisor.js";
import path from "path";
import fs from "fs";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

const serverApi = {
  getLatestContent: Content.getLatest,
  getContentCount: Content.getCount
};

async function renderAndSendHtml(res: any, contentData: any) {
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

  let dbConfig = await Setting.get(pgSettingSource, 'server_config');
  if (dbConfig) {
    if (typeof dbConfig === 'string') {
      try { dbConfig = JSON.parse(dbConfig); } catch (e) { }
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

  const headersInject = ((contentData as any).headers || "") + "\n" + payloadScript;
  html = html.replace("<!-- HEADERS_INJECT -->", headersInject);
  html = html.replace('<div id="app"></div>', `<div id="app">${htmlOutput || ""}</div>`);

  res.send(html);
}

async function renderContent(contentId: number, editorMode: string | null, req: any, res: any) {
  if (editorMode) {
    const user = req.user;
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return res.status(403).send("Forbidden: Must be admin or contributor to use edit mode");
    }
  }

  try {
    const contentRes = await Content.getWithTemplate(pgContentSource, pgTemplateSource, contentId, null, null, editorMode, req.user);
    if (!contentRes || 'error' in contentRes) {
      return res.status((contentRes as any)?.status || 404).send((contentRes as any)?.error || "Content not found");
    }

    const contentData = (contentRes as any).content;

    if (req.user) {
      contentData.payload.metadata = contentData.payload.metadata || {};
      contentData.payload.metadata.user = req.user;
      contentData.payload.userData = req.user;
    }

    await renderAndSendHtml(res, contentData);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).send("Internal server error");
  }
}

router.get("/", authenticateToken, async (req: any, res) => {
  try {
    const setting = await Setting.get(pgSettingSource, 'default_index_content_id');
    let defaultIndexId = (setting && setting.id) ? setting.id : null;

    if (req.user && req.user.home_page) {
      const contentRes = await Content.getWithTemplate(pgContentSource, pgTemplateSource, req.user.home_page, null, null, null, req.user);
      if (contentRes && !('error' in contentRes)) {
        defaultIndexId = req.user.home_page;
      } else {
        console.warn(`User homepage ${req.user.home_page} not found or forbidden, falling back to default`);
      }
    }

    if (!defaultIndexId) {
      return res.status(404).send("No default index configured");
    }
    logger.info(req.user);
    await renderContent(defaultIndexId, null, req, res);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).send("Internal server error");
  }
});

router.get("/reset-password", authenticateToken, async (req, res) => {
  try {
    const setting = await Setting.get(pgSettingSource, 'default_index_content_id');
    const defaultIndexId = (setting && setting.id) ? setting.id : null;

    if (!defaultIndexId) {
      return res.status(404).send("No default index configured");
    }

    await renderContent(defaultIndexId, null, req, res);
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).send("Internal server error");
  }
});

router.get("/content/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const editorMode = req.query.editorMode as string || null;
  await renderContent(contentId, editorMode, req, res);
});

router.get("/user/:username", authenticateToken, async (req, res) => {
  const username = req.params.username as string;
  const user = (req as any).user;
  
  try {
    const profilePayloadPath = path.join(process.cwd(), "library/contents/userProfile.json");
    if (!fs.existsSync(profilePayloadPath)) {
      return res.status(404).send("User profile template not found");
    }
    
    const targetUser = await User.getByUsername(pgUserSource, username);
    if (!targetUser) {
      return res.status(404).send("User not found");
    }
    
    const profilePayload = JSON.parse(fs.readFileSync(profilePayloadPath, "utf-8"));
    
    profilePayload.component = profilePayload.component || [];
    profilePayload.component.push({ reference: "username", value: `User Profile: ${targetUser.username}` });
    profilePayload.component.push({ reference: "role", value: `Role: ${targetUser.role}` });
    profilePayload.component.push({ reference: "home_page", value: targetUser.home_page ? `Home Page: ${targetUser.home_page}` : "" });
    
    if (user && user.username !== targetUser.username) {
      profilePayload.component.push({
        reference: "message_button",
        value: {
          type: "button",
          content: "Message User",
          component: [{"target": "handlers.click", "reference": "startMessage"}],
          props: { "data-target-user": targetUser.username },
          css: { style: { marginTop: "1.5rem", padding: "10px 20px", background: "#0070f3", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" } }
        }
      });
    }
    
    const templatePath = path.join(process.cwd(), "library/templates/navSidebar/desktop_light.json");
    const templatePayload = fs.existsSync(templatePath) ? JSON.parse(fs.readFileSync(templatePath, "utf-8")) : { type: "div", placement: { placementName: "article" } };

    const contentData = {
      template_payload: templatePayload,
      payload: profilePayload,
      metadata: { targetUsername: username }
    };
    
    if (user) {
      contentData.payload.metadata = contentData.payload.metadata || {};
      contentData.payload.metadata.user = user;
      contentData.payload.metadata.targetUsername = username;
      (contentData as any).userData = user;
    }

    await renderAndSendHtml(res, contentData);
  } catch (err: any) {
    logger.error({ err }, "An error occurred generating user profile");
    res.status(500).send("Internal Server Error");
  }
});



router.get(/(.*)/, authenticateToken, async (req, res, next) => {
  try {
    const aliases = await Setting.get(pgSettingSource, 'page_aliases');
    if (aliases && typeof aliases === 'object' && aliases[req.path]) {
      const contentId = aliases[req.path];
      await renderContent(contentId, null, req, res);
    } else {
      next(); // Pass to next middleware (like static files or 404 handler)
    }
  } catch (err) {
    logger.error({ err }, "An error occurred checking aliases");
    next(err);
  }
});


export default router;
