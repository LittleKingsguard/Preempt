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
import { loadLibraryData } from "../utils/setupLibrary.js";

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
    const userAgent = req.headers['user-agent']?.toLowerCase() || '';
    const device = userAgent.includes('mobile') ? 'mobile' : 'desktop';
    // Use optional chaining for cookies in case cookie-parser isn't used
    const theme = (req.cookies && req.cookies.theme) ? req.cookies.theme : 'dynamic';
    const tagsParam = `${device},${theme}`;

    const contentRes = await Content.getWithTemplate(pgContentSource, pgTemplateSource, contentId, null, tagsParam, editorMode, req.user);
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

let cachedAdminExists = false;

router.get("/", authenticateToken, async (req: any, res) => {
  try {
    if (!cachedAdminExists) {
      const adminExists = await User.hasAdmin(pgUserSource);
      if (!adminExists) {
        return res.redirect("/setup");
      }
      cachedAdminExists = true;
    }

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
          component: [{ "target": "handlers.click", "reference": "startMessage" }],
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

router.get("/setup", authenticateToken, async (req: any, res) => {
  try {
    const adminExists = await User.hasAdmin(pgUserSource);

    if (!req.user) {
      return res.redirect("/api/oauth/login");
    }

    if (adminExists) {
      const userObj = await User.getByUsername(pgUserSource, req.user.username);
      if (!userObj || 'error' in userObj || !(userObj as User).is_admin) {
        return res.status(403).send("Forbidden: Setup already completed.");
      }

      // Act as a development tool to reload library data
      await loadLibraryData(userObj as any);
      return res.send(`
        <html>
          <head><title>Library Reloaded</title></head>
          <body style="font-family: sans-serif; padding: 2rem; background: #f0f0f0;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <h1 style="color: green; margin-top: 0;">Library Reloaded</h1>
              <p>The library data (JSON components, templates, and settings) has been re-parsed and successfully re-inserted into the database.</p>
              <p><a href="/">Return to homepage</a></p>
            </div>
          </body>
        </html>
      `);
    }

    const html = `
      <html>
        <head><title>Preempt - First-Time Setup</title></head>
        <body style="font-family: sans-serif; padding: 2rem; background: #f0f0f0;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="margin-top: 0;">First-Time Setup</h1>
            <p>Welcome, <strong>${req.user.username}</strong>! Please initialize the database to finish setup. JWT and OIDC secrets will be automatically generated and saved to your configuration. You will be automatically elevated to system administrator.</p>
            <form method="POST" action="/api/setup/initialize" style="display: flex; flex-direction: column; gap: 15px;">
              <label style="display: flex; flex-direction: column; gap: 5px; font-weight: bold;">
                Postgres Password (Optional)
                <input type="password" name="POSTGRES_PASSWORD" placeholder="Leave blank to auto-generate" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
              </label>
              <button type="submit" style="padding: 10px; background: #0070f3; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">
                Initialize Database & Save Config
              </button>
            </form>
          </div>
        </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err }, "An error occurred during setup");
    res.status(500).send("Internal server error");
  }
});


router.get("/setup/traefik", authenticateToken, async (req: any, res) => {
  try {
    const userObj = await User.getByUsername(pgUserSource, req.user.username);
    if (!userObj || 'error' in userObj || !(userObj as User).is_admin) {
      return res.status(403).send("Forbidden: Only an admin can configure Traefik.");
    }

    const html = `
      <html>
        <head>
          <title>Preempt - Traefik Production Setup</title>
          <script>
            function toggleSslMode() {
              const mode = document.getElementById('sslMode').value;
              document.getElementById('letsencrypt-fields').style.display = mode === 'letsencrypt' ? 'block' : 'none';
              document.getElementById('custom-ssl-fields').style.display = mode === 'custom' ? 'block' : 'none';
            }
          </script>
        </head>
        <body style="font-family: sans-serif; padding: 2rem; background: #f0f0f0;">
          <div style="max-width: 600px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="margin-top: 0;">Configure Production DNS & SSL</h1>
            <p>Generate a production-ready <code>docker-compose.prod.yml</code> to run Preempt with Traefik routing and HTTPS.</p>
            
            <form method="POST" action="/api/setup/traefik" style="display: flex; flex-direction: column; gap: 15px;">
              <label style="display: flex; flex-direction: column; gap: 5px; font-weight: bold;">
                Domain Name
                <input type="text" name="domain" required placeholder="e.g. app.mycompany.com" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
              </label>

              <label style="display: flex; flex-direction: column; gap: 5px; font-weight: bold;">
                SSL Mode
                <select id="sslMode" name="sslMode" onchange="toggleSslMode()" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                  <option value="letsencrypt">Let's Encrypt (Automatic)</option>
                  <option value="custom">Custom SSL (CSR Generation)</option>
                </select>
              </label>

              <div id="letsencrypt-fields">
                <label style="display: flex; flex-direction: column; gap: 5px; font-weight: bold;">
                  Admin Email (for Let's Encrypt notifications)
                  <input type="email" name="email" placeholder="admin@mycompany.com" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
                </label>
              </div>

              <div id="custom-ssl-fields" style="display: none; background: #f9f9f9; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
                <h3 style="margin-top: 0;">CSR Organization Details</h3>
                <p style="font-size: 0.9em; color: #555;">We will generate a Private Key and CSR. These fields are required for generation.</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <label style="display: flex; flex-direction: column; gap: 2px;">
                    Organization (O)
                    <input type="text" name="orgData[organization]" required placeholder="My Company LLC" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
                  </label>
                  <label style="display: flex; flex-direction: column; gap: 2px;">
                    Organizational Unit (OU)
                    <input type="text" name="orgData[organizationalUnit]" required placeholder="IT" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
                  </label>
                  <label style="display: flex; flex-direction: column; gap: 2px;">
                    City/Locality (L)
                    <input type="text" name="orgData[locality]" required placeholder="San Francisco" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
                  </label>
                  <label style="display: flex; flex-direction: column; gap: 2px;">
                    State/Province (ST)
                    <input type="text" name="orgData[state]" required placeholder="California" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
                  </label>
                  <label style="display: flex; flex-direction: column; gap: 2px;">
                    Country (C)
                    <input type="text" name="orgData[country]" required placeholder="US" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
                  </label>
                </div>
              </div>

              <button type="submit" style="padding: 10px; background: #0070f3; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; margin-top: 10px;">
                Generate Production Config
              </button>
            </form>
          </div>
        </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err }, "An error occurred rendering Traefik setup");
    res.status(500).send("Internal server error");
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
