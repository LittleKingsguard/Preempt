import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { authenticateToken } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { loadLibraryData } from "../../utils/setupLibrary.js";
import { User } from "../../models/user.js";
import { pgUserSource } from "../../sources/userSource.js";
import { pool } from "../../db.js";


const router = express.Router();

router.post("/initialize", authenticateToken, async (req: any, res) => {
  const tokenUser = req.user;
  const adminExists = await User.hasAdmin(pgUserSource);
  if (adminExists) {
    return res.status(403).send("Forbidden: Setup already completed.");
  }
  
  if (!tokenUser) {
    return res.status(401).send("Unauthorized: Please log in first.");
  }
  const { POSTGRES_PASSWORD } = req.body || {};
  
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
    updateOrAddEnv("PGPASSWORD", finalPostgresPassword);
    updateOrAddEnv("KEYCLOAK_ADMIN", tokenUser.username);
    updateOrAddEnv("KEYCLOAK_ADMIN_PASSWORD", finalPostgresPassword);
    
    fs.writeFileSync(envPath, envContent.trim() + "\n");
    logger.info("Updated .env file with new secrets.");
    
    // Sync Keycloak
    try {
      const currentAdmin = process.env.KEYCLOAK_ADMIN || "admin";
      const currentAdminPass = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";
      const tokenRes = await fetch('http://keycloak:8080/auth/realms/master/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=admin-cli&username=${currentAdmin}&password=${currentAdminPass}&grant_type=password`
      });
      const tokenData = await tokenRes.json();
      const token = tokenData.access_token;
      
      const clientsRes = await fetch('http://keycloak:8080/auth/admin/realms/preempt/clients?clientId=preempt-app', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const clientsData = await clientsRes.json();
      if (clientsData && clientsData.length > 0) {
        const clientId = clientsData[0].id;
        await fetch('http://keycloak:8080/auth/admin/realms/preempt/clients/' + clientId, {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...clientsData[0], secret: OIDC_CLIENT_SECRET })
        });
        logger.info("Successfully synced Keycloak client secret.");
      }
      
      // Change default admin login to the new user
      if (currentAdmin !== tokenUser.username) {
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
          
            const fullUserRes = await fetch(`http://keycloak:8080/auth/admin/realms/master/users/${adminUserId}`, {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            const fullUser = await fullUserRes.json();
            fullUser.username = tokenUser.username;
            
            const putRes = await fetch(`http://keycloak:8080/auth/admin/realms/master/users/${adminUserId}`, {
              method: 'PUT',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify(fullUser)
            });
            if (!putRes.ok) {
              logger.error(`Failed to update Keycloak admin username: ${await putRes.text()}`);
            }

            const passRes = await fetch(`http://keycloak:8080/auth/admin/realms/master/users/${adminUserId}/reset-password`, {
              method: 'PUT',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: "password",
                value: finalPostgresPassword,
                temporary: false
              })
            });
            if (!passRes.ok) {
              logger.error(`Failed to reset Keycloak admin password: ${await passRes.text()}`);
            }

            // Update process.env so subsequent requests in this process use the new credentials
            process.env.KEYCLOAK_ADMIN = tokenUser.username;
            process.env.KEYCLOAK_ADMIN_PASSWORD = finalPostgresPassword;

            logger.info("Successfully updated Keycloak master admin login to new user.");
          }
        
        // Revert editUsernameAllowed
        await fetch('http://keycloak:8080/auth/admin/realms/master', {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ editUsernameAllowed: false })
        });
      }

    } catch (kcErr) {
      logger.error({ kcErr }, "Failed to sync Keycloak configuration");
    }
    
    // 2. Elevate the human user and use them for authoring the library content
    let dbUser: any = await User.getByUsername(pgUserSource, tokenUser.username);
    if (dbUser && !('error' in dbUser)) {
      await (dbUser as User).updateRoles({ is_admin: true, is_contributor: true });
      dbUser.is_admin = true;
      dbUser.is_contributor = true;
    }

    await loadLibraryData(dbUser);
    
    // 3. Complete admin configuration (host)
    if (dbUser && !('error' in dbUser)) {
      const user = dbUser as User;
      await user.addValidatedHost(process.env.OIDC_ISSUER || "");

      logger.info("Admin user properly configured.");
    }
    
    // We DO change the Postgres password here now, since the workers use dotenv override to 
    // dynamically reload their environment on 'docker restart' without needing full container recreation.
    const pgUser = process.env.PGUSER || "preempt";
    await pool.query(`ALTER USER ${pgUser} WITH PASSWORD '${finalPostgresPassword}'`);
    logger.info("Updated postgres database password.");
    
    // Return success page prompting a restart
    const html = `
      <html>
        <head><title>Preempt - Setup Complete</title></head>
        <body style="font-family: sans-serif; padding: 2rem; background: #f0f0f0;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: green;">Setup Complete!</h1>
            <p>Your secrets have been saved to the <code>.env</code> file, and the initial library components have been loaded into the database.</p>
            <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 4px; border: 1px solid #ffeeba; margin: 20px 0;">
              <strong>Action Required:</strong>
              <p>You MUST restart the Docker containers for the OIDC secrets to take effect.</p>
              <code>docker restart preempt_backend</code>
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
