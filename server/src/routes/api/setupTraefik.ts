import express from "express";
import fs from "fs";
import path from "path";
import forge from "node-forge";
import yaml from "yaml";
import { authenticateToken } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { User } from "../../models/user.js";
import { pgUserSource } from "../../sources/userSource.js";

import crypto from "crypto";

const router = express.Router();

function getOrCreatePrivateKeyPem(certsDir: string): { pemKey: string; privateKeyForge: forge.pki.rsa.PrivateKey } {
  const keyPath = path.join(certsDir, "server.key");
  if (fs.existsSync(keyPath)) {
    try {
      const pemKey = fs.readFileSync(keyPath, "utf-8");
      crypto.createPrivateKey(pemKey); // Verify valid key with Node native crypto
      const privateKeyForge = forge.pki.privateKeyFromPem(pemKey);
      logger.info("Reusing existing private key from certs/server.key for CSR generation.");
      return { pemKey, privateKeyForge };
    } catch (err) {
      logger.warn({ err }, "Could not parse existing certs/server.key as PKCS#1. Generating matching PKCS#1 key pair.");
    }
  }

  const { privateKey: nodePrivateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" }
  });
  
  fs.writeFileSync(keyPath, nodePrivateKey);
  const privateKeyForge = forge.pki.privateKeyFromPem(nodePrivateKey);
  return { pemKey: nodePrivateKey, privateKeyForge };
}

function generateCSR(domain: string, orgData: any, certsDir: string) {
  const { pemKey, privateKeyForge } = getOrCreatePrivateKeyPem(certsDir);
  const publicKey = forge.pki.setRsaPublicKey(privateKeyForge.n, privateKeyForge.e);

  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = publicKey;

  const subject = [
    { name: 'commonName', value: domain },
    { name: 'countryName', value: orgData.country },
    { shortName: 'ST', value: orgData.state },
    { name: 'localityName', value: orgData.locality },
    { name: 'organizationName', value: orgData.organization },
    { shortName: 'OU', value: orgData.organizationalUnit }
  ];

  csr.setSubject(subject);
  csr.sign(privateKeyForge);

  // Create a matching self-signed cert placeholder if server.crt does not exist
  const certPath = path.join(certsDir, "server.crt");
  if (!fs.existsSync(certPath)) {
    const cert = forge.pki.createCertificate();
    cert.publicKey = publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.sign(privateKeyForge, forge.md.sha256.create());
    const pemCert = forge.pki.certificateToPem(cert);
    fs.writeFileSync(certPath, pemCert);
  }

  const pemCsr = forge.pki.certificationRequestToPem(csr);
  return { pemCsr, pemKey };
}

router.post("/", authenticateToken, async (req: any, res) => {
  const tokenUser = req.user;
  
  if (!tokenUser) {
    return res.status(401).send("Unauthorized");
  }

  const dbUser = await User.getByUsername(pgUserSource, tokenUser.username);
  if (!dbUser || 'error' in dbUser || !(dbUser as User).is_admin) {
    return res.status(403).send("Forbidden: Only an admin can initialize the system.");
  }
  
  const { domain, sslMode, email, orgData } = req.body;
  if (!domain) {
    return res.status(400).send("Domain is required.");
  }
  
  if (sslMode === 'custom') {
    if (!orgData || !orgData.country || !orgData.state || !orgData.locality || !orgData.organization || !orgData.organizationalUnit) {
      return res.status(400).send("CSR details (Country, State, Locality, Organization, OU) are required for Custom SSL.");
    }
  }

  try {
    const envPath = path.join(process.cwd(), ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : "";
    
    const updateOrAddEnv = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };
    
    updateOrAddEnv("DOMAIN", domain);
    if (sslMode === 'letsencrypt' && email) {
      updateOrAddEnv("ACME_EMAIL", email);
    }
    
    fs.writeFileSync(envPath, envContent.trim() + "\n");
    logger.info("Updated .env file with DNS/SSL config.");

    let csrPem = null;
    let traefikDynamicYaml = "";
    let composeYaml = "";

    if (sslMode === 'custom') {
      const certsDir = path.join(process.cwd(), "certs");
      if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir);
      }
      const { pemCsr } = generateCSR(domain, orgData || {}, certsDir);
      csrPem = pemCsr;
      
      // We'll write the dynamic config to /app/traefik-dynamic.yml (which is ./server/traefik-dynamic.yml on host)
      traefikDynamicYaml = `tls:
  certificates:
    - certFile: /certs/server.crt
      keyFile: /certs/server.key
  stores:
    default:
      defaultCertificate:
        certFile: /certs/server.crt
        keyFile: /certs/server.key
`;
      fs.writeFileSync(path.join(process.cwd(), "traefik-dynamic.yml"), traefikDynamicYaml);
    }

    const composeSourcePath = path.join(process.cwd(), "docker-compose.yml");
    const composeStr = fs.readFileSync(composeSourcePath, 'utf8');
    const composeDoc = yaml.parseDocument(composeStr);
    
    // 1. Modify Traefik
    const traefik = composeDoc.getIn(['services', 'traefik']) as any;
    if (traefik) {
      const newTraefikCommands = [
        "--api.insecure=false",
        "--providers.docker=true",
        "--entrypoints.web.address=:80",
        "--entrypoints.websecure.address=:443",
        "--entrypoints.web.http.redirections.entryPoint.to=websecure",
        "--entrypoints.web.http.redirections.entryPoint.scheme=https"
      ];
      if (sslMode === 'letsencrypt') {
        newTraefikCommands.push("--certificatesresolvers.myresolver.acme.tlschallenge=true");
        if (email) newTraefikCommands.push(`--certificatesresolvers.myresolver.acme.email=${email}`);
        newTraefikCommands.push("--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json");
      } else {
        newTraefikCommands.push("--providers.file.filename=/traefik-dynamic.yml");
        newTraefikCommands.push("--providers.file.watch=true");
      }
      traefik.set('command', composeDoc.createNode(newTraefikCommands));
      traefik.set('ports', composeDoc.createNode(["80:80", "443:443"]));

      const traefikVolumesNode = traefik.get('volumes') as any;
      const traefikVolumes = traefikVolumesNode ? traefikVolumesNode.toJSON() : [];
      const filteredVolumes = traefikVolumes.filter((v: string) => !v.includes('letsencrypt') && !v.includes('traefik-dynamic') && !v.includes('/certs'));
      
      if (sslMode === 'letsencrypt') {
        filteredVolumes.push("preempt_letsencrypt:/letsencrypt");
      } else {
        filteredVolumes.push("./certs:/certs:ro");
        filteredVolumes.push("./traefik-dynamic.yml:/traefik-dynamic.yml:ro");
      }
      traefik.set('volumes', composeDoc.createNode(filteredVolumes));
    }

    // 2. Update Backend
    const backend = composeDoc.getIn(['services', 'backend']) as any;
    if (backend) {
      const backendEnv = backend.get('environment');
      if (backendEnv) {
        backendEnv.set('OIDC_ISSUER', `https://${domain}/auth/realms/preempt`);
        backendEnv.set('OIDC_REDIRECT_URI', `https://${domain}/api/oauth/callback`);
        backendEnv.set('NODE_TLS_REJECT_UNAUTHORIZED', '1');
      }

      const backendLabelsNode = backend.get('labels') as any;
      let backendLabels = backendLabelsNode ? backendLabelsNode.toJSON() : [];
      backendLabels = backendLabels.filter((l: string) => !l.startsWith('traefik.http.routers.backend') && !l.startsWith('traefik.http.routers.oauth') && !l.startsWith('traefik.http.middlewares') && !l.startsWith('traefik.http.services'));
      
      backendLabels.push(`traefik.http.middlewares.hsts-headers.headers.stsSeconds=31536000`);
      backendLabels.push(`traefik.http.middlewares.hsts-headers.headers.stsIncludeSubdomains=true`);
      backendLabels.push(`traefik.http.middlewares.hsts-headers.headers.stsPreload=true`);

      backendLabels.push(`traefik.http.routers.backend.rule=Host(\`${domain}\`)`);
      backendLabels.push('traefik.http.routers.backend.priority=1');
      backendLabels.push('traefik.http.routers.backend.entrypoints=websecure');
      backendLabels.push('traefik.http.routers.backend.middlewares=hsts-headers');
      backendLabels.push('traefik.http.routers.backend.service=backend');
      backendLabels.push('traefik.http.services.backend.loadbalancer.server.port=3001');
      if (sslMode === 'letsencrypt') {
        backendLabels.push('traefik.http.routers.backend.tls.certresolver=myresolver');
      } else {
        backendLabels.push('traefik.http.routers.backend.tls=true');
      }
      
      backendLabels.push(`traefik.http.routers.oauth.rule=Host(\`${domain}\`) && PathPrefix(\`/api/oauth\`)`);
      backendLabels.push('traefik.http.routers.oauth.priority=10');
      backendLabels.push('traefik.http.routers.oauth.entrypoints=websecure');
      backendLabels.push('traefik.http.routers.oauth.middlewares=hsts-headers');
      backendLabels.push('traefik.http.routers.oauth.service=oauth');
      backendLabels.push('traefik.http.services.oauth.loadbalancer.server.port=3002');
      if (sslMode === 'letsencrypt') {
        backendLabels.push('traefik.http.routers.oauth.tls.certresolver=myresolver');
      } else {
        backendLabels.push('traefik.http.routers.oauth.tls=true');
      }
      backend.set('labels', composeDoc.createNode(backendLabels));
    }

    // 3. Update Keycloak
    const keycloak = composeDoc.getIn(['services', 'keycloak']) as any;
    if (keycloak) {
      const kcEnv = keycloak.get('environment');
      if (kcEnv) {
        kcEnv.set('KC_HOSTNAME', domain);
        kcEnv.set('KC_HOSTNAME_PORT', '443');
        kcEnv.set('KC_HOSTNAME_STRICT_HTTPS', 'true');
      }
      keycloak.set('command', 'start --import-realm');

      const kcLabelsNode = keycloak.get('labels') as any;
      let kcLabels = kcLabelsNode ? kcLabelsNode.toJSON() : [];
      kcLabels = kcLabels.filter((l: string) => !l.startsWith('traefik.http.routers.keycloak'));
      kcLabels.push(`traefik.http.routers.keycloak.rule=Host(\`${domain}\`) && PathPrefix(\`/auth\`)`);
      kcLabels.push('traefik.http.routers.keycloak.entrypoints=websecure');
      kcLabels.push('traefik.http.routers.keycloak.middlewares=hsts-headers');
      if (sslMode === 'letsencrypt') {
        kcLabels.push('traefik.http.routers.keycloak.tls.certresolver=myresolver');
      } else {
        kcLabels.push('traefik.http.routers.keycloak.tls=true');
      }
      keycloak.set('labels', composeDoc.createNode(kcLabels));

      // Update realm-export.json to enforce sslRequired: external once SSL is configured
      const realmPath = path.join(process.cwd(), "keycloak-config", "realm-export.json");
      if (fs.existsSync(realmPath)) {
        try {
          const realmData = JSON.parse(fs.readFileSync(realmPath, "utf-8"));
          realmData.sslRequired = "external";
          fs.writeFileSync(realmPath, JSON.stringify(realmData, null, 2));
          logger.info("Updated keycloak-config/realm-export.json with sslRequired: external");
        } catch (e) {
          logger.warn({ err: e }, "Failed to update realm-export.json sslRequired setting");
        }
      }
    }

    // 4. Update global volumes
    let volumes = composeDoc.get('volumes') as any;
    if (!volumes) {
      composeDoc.set('volumes', composeDoc.createNode({}));
      volumes = composeDoc.get('volumes');
    }
    if (sslMode === 'letsencrypt') {
      if (!volumes.get('preempt_letsencrypt')) {
        volumes.set('preempt_letsencrypt', null);
      }
    } else {
      volumes.delete('preempt_letsencrypt');
    }

    composeYaml = String(composeDoc);

    // Save the new compose file as a download/display string rather than overwriting
    // Actually, we can write it to `/app/docker-compose.prod.yml` and tell the user to copy it.
    const composePath = path.join(process.cwd(), "docker-compose.prod.yml");
    fs.writeFileSync(composePath, composeYaml);
    
    // We will just render the success page
    const html = `
      <html>
        <head><title>Preempt - Traefik Setup Complete</title></head>
        <body style="font-family: sans-serif; padding: 2rem; background: #f0f0f0;">
          <div style="max-width: 700px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: green;">Traefik Configured!</h1>
            <p>Your production configuration has been generated and saved to <code>docker-compose.prod.yml</code>.</p>
            ${csrPem ? `
            <div style="margin-top: 20px; padding: 15px; border: 1px solid #ccc; background: #f9f9f9; border-radius: 4px;">
              <h3 style="margin-top: 0;">Custom SSL Action Required:</h3>
              <p>We generated a Private Key and CSR. The Private Key is saved securely at <code>certs/server.key</code>.</p>
              <p>Please provide the following CSR to your Certificate Authority to get your signed certificate:</p>
              <textarea readonly style="width: 100%; height: 200px; font-family: monospace; padding: 10px;">${csrPem}</textarea>
              <p>Once you receive your signed certificate (e.g. <code>server.crt</code>), save it to <code>certs/server.crt</code> before starting the production stack.</p>
            </div>
            ` : ""}
            
            <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 4px; border: 1px solid #ffeeba; margin: 20px 0;">
              <strong>Final Step:</strong>
              <p>To apply these changes and start the production stack with HTTPS enabled, run the following commands on your host server:</p>
              <code>docker compose down</code><br/>
              <code>cp docker-compose.prod.yml ./docker-compose.yml</code><br/>
              <code>docker compose up -d</code>
            </div>
            <p><a href="/">Return to homepage</a></p>
          </div>
        </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err }, "Failed to configure Traefik");
    res.status(500).send("Internal server error during Traefik setup.");
  }
});

export default router;
