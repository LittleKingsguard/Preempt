import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { authenticateToken } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { loadLibraryData } from "../../utils/setupLibrary.js";
import { User } from "../../models/user.js";
import { pgUserSource } from "../../sources/userSource.js";

const router = express.Router();

router.post("/initialize", authenticateToken, async (req: any, res) => {
  const tokenUser = req.user;
  
  if (!tokenUser) {
    return res.status(401).send("Unauthorized");
  }

  const dbUser = await User.getByUsername(pgUserSource, tokenUser.username);
  if (!dbUser || 'error' in dbUser || !(dbUser as User).is_admin) {
    return res.status(403).send("Forbidden: Only an admin can initialize the system.");
  }
  
  const { POSTGRES_PASSWORD } = req.body;
  
  const JWT_SECRET = crypto.randomBytes(32).toString('hex');
  const OIDC_CLIENT_SECRET = crypto.randomBytes(32).toString('hex');
  const finalPostgresPassword = POSTGRES_PASSWORD || crypto.randomBytes(16).toString('hex');
  
  try {
    // 1. Update .env
    const envPath = path.join(process.cwd(), ".env"); // because it's mounted from root
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : "";
    
    const updateOrAddEnv = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };
    
    updateOrAddEnv("JWT_SECRET", JWT_SECRET);
    updateOrAddEnv("OIDC_CLIENT_SECRET", OIDC_CLIENT_SECRET);
    updateOrAddEnv("POSTGRES_PASSWORD", finalPostgresPassword);
    
    fs.writeFileSync(envPath, envContent.trim() + "\n");
    logger.info("Updated .env file with new secrets.");
    
    // 2. Load Library Data
    await loadLibraryData(dbUser);
    
    // 3. Render success page prompting a restart
    const html = `
      <html>
        <head><title>Preempt - Setup Complete</title></head>
        <body style="font-family: sans-serif; padding: 2rem; background: #f0f0f0;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: green;">Setup Complete!</h1>
            <p>Your secrets have been saved to the <code>.env</code> file, and the initial library components have been loaded into the database.</p>
            <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 4px; border: 1px solid #ffeeba; margin: 20px 0;">
              <strong>Action Required:</strong>
              <p>You MUST restart the Docker containers for the new database passwords and OIDC secrets to take effect.</p>
              <code>docker compose down && docker compose up -d</code>
            </div>
            <p>After restarting, you can navigate back to <a href="/">the homepage</a>.</p>
          </div>
        </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err }, "Failed to initialize setup");
    res.status(500).send("Internal server error during initialization.");
  }
});

export default router;
