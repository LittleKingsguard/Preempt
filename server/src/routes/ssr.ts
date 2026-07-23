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
import { Template } from "../../../src/core/Template.js";
import type { ContentPayload } from "../../../src/types/NodeSchema.js";
import path from "path";
import fs from "fs";
import { authenticateToken } from "../middleware/auth.js";
import { loadLibraryData } from "../utils/setupLibrary.js";
import { pool } from "../db.js";

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

  let htmlOutput = "";
  let payloadObj: ContentPayload = contentData.payload;
  if (!payloadObj || !Array.isArray(payloadObj.content)) {
    payloadObj = {
      content: Array.isArray(contentData.payload) ? contentData.payload : (contentData.payload ? [contentData.payload] : []),
      metadata: (contentData as any).metadata || contentData.payload?.metadata,
      userData: (contentData as any).userData || contentData.payload?.userData,
      component: contentData.payload?.component
    };
  }

  if (serverConfig.runInstantiation) {
    const template = new Template(contentData.template_payload);
    htmlOutput = (await Supervisor.process(serverConfig, template, payloadObj, serverApi)) as string || "";
  }

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
    content: payloadObj,
    clientConfig: clientConfig
  })}</script>`;

  const headersInject = ((contentData as any).headers || "") + "\n" + payloadScript;
  html = html.replace("<!-- HEADERS_INJECT -->", headersInject);
  if (serverConfig.runInstantiation && htmlOutput) {
    html = html.replace('<div id="app"></div>', `<div id="app">${htmlOutput}</div>`);
  }

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
    const editorMode = req.query.editorMode as string || null;
    await renderContent(defaultIndexId, editorMode, req, res);
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
    const templatePayload = fs.existsSync(templatePath) ? JSON.parse(fs.readFileSync(templatePath, "utf-8")) : { type: "div", placement: [{ placementName: "article" }] };

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

router.get("/login", (req, res) => {
  res.redirect("/api/oauth/login");
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

router.all("/revert", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).send("Forbidden: Route only available in development mode");
  }

  try {
    logger.info("Starting /revert database rollback...");

    // 1. Revert Keycloak configuration if possible
    try {
      const currentAdmin = process.env.KEYCLOAK_ADMIN || "admin";
      const currentAdminPass = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";

      logger.info(`Authenticating with Keycloak as ${currentAdmin} to revert credentials...`);
      let tokenRes = await fetch('http://keycloak:8080/auth/realms/master/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=admin-cli&username=${currentAdmin}&password=${currentAdminPass}&grant_type=password`
      });

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        const token = tokenData.access_token;

        // Reset preempt-app client secret to default "secret"
        const clientsRes = await fetch('http://keycloak:8080/auth/admin/realms/preempt/clients?clientId=preempt-app', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const clientsData = await clientsRes.json();
        if (clientsData && clientsData.length > 0) {
          const clientId = clientsData[0].id;
          await fetch('http://keycloak:8080/auth/admin/realms/preempt/clients/' + clientId, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...clientsData[0], secret: "secret" })
          });
          logger.info("Keycloak client secret reset to 'secret'.");
        }

        // Change master admin username back to "admin" and password back to "admin"
        if (currentAdmin !== "admin") {
          // Allow editing username in master realm
          await fetch('http://keycloak:8080/auth/admin/realms/master', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ editUsernameAllowed: true })
          });

          const usersRes = await fetch(`http://keycloak:8080/auth/admin/realms/master/users?username=${currentAdmin}`, {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const usersData = await usersRes.json();
          if (usersData && usersData.length > 0) {
            const adminUserId = usersData[0].id;
            await fetch(`http://keycloak:8080/auth/admin/realms/master/users/${adminUserId}`, {
              method: 'PUT',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: "admin"
              })
            });

            await fetch(`http://keycloak:8080/auth/admin/realms/master/users/${adminUserId}/reset-password`, {
              method: 'PUT',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: "password",
                value: "admin",
                temporary: false
              })
            });

            // Revert process.env so subsequent requests use the default credentials
            process.env.KEYCLOAK_ADMIN = "admin";
            process.env.KEYCLOAK_ADMIN_PASSWORD = "admin";
            logger.info("Keycloak master admin reverted to admin/admin.");
          }

          // Revert editUsernameAllowed
          await fetch('http://keycloak:8080/auth/admin/realms/master', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ editUsernameAllowed: false })
          });
        }
      } else {
        logger.error(`Failed to get Keycloak token: status ${tokenRes.status}`);
        throw new Error(`Failed to authenticate with Keycloak (status ${tokenRes.status})`);
      }
    } catch (kcErr: any) {
      logger.error({ kcErr }, "Failed to revert Keycloak configuration");
      throw new Error(`Failed to reset Keycloak configuration: ${kcErr.message || kcErr}`);
    }

    // 2. Drop only Preempt tables
    const dropSql = `
      DROP TABLE IF EXISTS
        Events, Messages, MessageLists, Comments, CommentLists, SiteSettings,
        ComponentHandlers, ContentComponents, TemplateComponents, Components,
        ContentHandlers, TemplateHandlers, Handlers, ContentTags, TemplateTags,
        Tags, ContentTemplateGroups, ContentUserGroups, UserGroupMembers, UserGroups,
        ContentUsers, Content, Templates, TemplateGroups, ChangeBatches,
        AuthTokens, Users
      CASCADE;
    `;
    logger.info("Dropping Preempt database tables...");
    await pool.query(dropSql);

    // 3. Recreate Preempt tables using schema.sql
    logger.info("Recreating Preempt database schema from schema.sql...");
    const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf-8');
    await pool.query(schemaSql);

    // 5. Clean up .env file (remove setup secrets but keep postgres connection config)
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      logger.info("Cleaning setup secrets from .env...");
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const lines = envContent.split('\n');
      const keysToRemove = ['JWT_SECRET', 'OIDC_CLIENT_SECRET', 'KEYCLOAK_ADMIN', 'KEYCLOAK_ADMIN_PASSWORD'];
      const newLines = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        const parts = trimmed.split('=');
        const firstPart = parts[0];
        if (firstPart === undefined) return false;
        const key = firstPart.trim();
        return !keysToRemove.includes(key);
      });
      fs.writeFileSync(envPath, newLines.join('\n') + '\n');
    }

    cachedAdminExists = false;

    logger.info("Revert sequence complete. Restarting server...");
    res.send(`
      <div>Database reverted to pre-setup state successfully. The server is restarting...</div>
      <br />
      <a href="/">Return to Homepage</a>
    `);
    
    // 6. Graceful restart by terminating process (Docker restart: always will boot it back up)
    setTimeout(() => {
      try {
        logger.info("Sending SIGTERM to parent process to trigger full container restart...");
        process.kill(process.ppid, 'SIGTERM');
      } catch (err) {
        logger.error({ err }, "Failed to kill parent process, calling process.exit(0)");
        process.exit(0);
      }
    }, 1000);

  } catch (err) {
    logger.error({ err }, "Failed to execute /revert");
    res.status(500).send("Internal server error during database revert.");
  }
});

router.all("/sync", authenticateToken, async (req: any, res) => {
  const tokenUser = req.user;
  if (!tokenUser) {
    return res.status(401).send("Unauthorized: Please log in first.");
  }
  const dbUser: any = await User.getByUsername(pgUserSource, tokenUser.username);
  if (!dbUser || dbUser.error || (!dbUser.is_admin && !dbUser.is_contributor)) {
    return res.status(403).send("Forbidden: Must be admin or contributor to sync library.");
  }

  try {
    logger.info("Starting /sync database wipe and rebuild...");

    // 1. Temporarily drop the Users.home_page constraint to prevent CASCADE from truncating Users
    await pool.query("ALTER TABLE Users DROP CONSTRAINT fk_user_home_page;");
    await pool.query("UPDATE Users SET home_page = NULL;");

    // 2. Truncate all Preempt library/content tables
    const truncateSql = `
      TRUNCATE TABLE
        Events, Messages, MessageLists, Comments, CommentLists,
        ComponentHandlers, ContentComponents, TemplateComponents, Components,
        ContentHandlers, TemplateHandlers, Handlers, ContentTags, TemplateTags,
        Tags, ContentTemplateGroups, ContentUserGroups, UserGroupMembers, UserGroups,
        ContentUsers, Content, Templates, TemplateGroups, ChangeBatches
      RESTART IDENTITY CASCADE;
    `;
    logger.info("Truncating Preempt library tables...");
    await pool.query(truncateSql);

    // 3. Restore the Users.home_page constraint
    await pool.query("ALTER TABLE Users ADD CONSTRAINT fk_user_home_page FOREIGN KEY (home_page) REFERENCES Content(id) ON DELETE SET NULL;");

    // 4. Reload Library Data
    await loadLibraryData(dbUser);

    logger.info("Sync sequence complete. Restarting server...");
    res.send(`
      <div>Database synced successfully. The server is restarting...</div>
      <br />
      <a href="/">Return to Homepage</a>
    `);
    
    // 5. Graceful restart
    setTimeout(() => {
      try {
        logger.info("Sending SIGTERM to parent process to trigger full container restart...");
        process.kill(process.ppid, 'SIGTERM');
      } catch (err) {
        logger.error({ err }, "Failed to kill parent process, calling process.exit(0)");
        process.exit(0);
      }
    }, 1000);

  } catch (err) {
    logger.error({ err }, "Failed to execute /sync");
    res.status(500).send("Internal server error during database sync.");
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
