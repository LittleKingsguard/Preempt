// Override global fetch in development so that when openid-client tries to contact
// "localhost" (the external OIDC issuer), it correctly routes to the internal "keycloak:8080" container.
// THIS MUST RUN BEFORE IMPORTING openid-client!
if (process.env.NODE_ENV !== "production") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, options: any) => {
    let fetchUrl = url;
    let rewritten = false;
    if (typeof fetchUrl === 'string' && fetchUrl.startsWith('http://localhost')) {
      fetchUrl = fetchUrl.replace('http://localhost:8080', 'http://keycloak:8080').replace('http://localhost', 'http://keycloak:8080');
      rewritten = true;
    } else if (fetchUrl instanceof URL && fetchUrl.hostname === 'localhost') {
      fetchUrl = new URL(fetchUrl.href);
      fetchUrl.hostname = 'keycloak';
      fetchUrl.port = '8080';
      rewritten = true;
    } else if (fetchUrl instanceof Request) {
       const reqUrl = new URL(fetchUrl.url);
       if (reqUrl.hostname === 'localhost') {
         reqUrl.hostname = 'keycloak';
         reqUrl.port = '8080';
         fetchUrl = new Request(reqUrl, fetchUrl);
         rewritten = true;
       }
    }
    
    // Force the X-Forwarded headers so Keycloak knows the original public URL
    if (rewritten) {
      options = options || {};
      options.headers = new Headers(options.headers || {});
      options.headers.set('X-Forwarded-Host', 'localhost');
      options.headers.set('X-Forwarded-Port', '80');
      options.headers.set('X-Forwarded-Proto', 'http');
    }
    
    console.log("Fetch override called:", { originalUrl: url.toString?.() || url, fetchUrl: fetchUrl.toString?.() || fetchUrl, rewritten });
    return originalFetch(fetchUrl, options);
  };
}

import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import * as client from "openid-client";
import { User } from "../models/user.js";
import { pgUserSource } from "../sources/userSource.js";
import { logger } from "../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

const app = express();
app.use(cookieParser());
app.use(express.json());



const PORT = process.env.OAUTH_PORT || 3002;
const OIDC_ISSUER = process.env.OIDC_ISSUER || "http://keycloak:8080/realms/preempt";
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "preempt-app";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "secret";
if (!process.env.OIDC_REDIRECT_URI) {
  logger.error("OIDC_REDIRECT_URI environment variable is required");
  process.exit(1);
}
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
const OIDC_SCOPES = process.env.OIDC_SCOPES || "openid email profile";

let config: client.Configuration;

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Helper to issue JWT
function issuePreemptSession(res: express.Response, user: any) {
  (user as any).hasAuthenticated = true;
  const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

async function getOIDCConfig() {
  if (config) return config;

  // We expect Keycloak's public frontend URL as the issuer.
  // Because Keycloak internally thinks it's on port 8080 (even with KC_HOSTNAME_PORT=80), 
  // its discovery metadata will contain `localhost:8080`.
  // We use an interceptor to route the request to `keycloak:8080` internally 
  // AND rewrite the JSON response so openid-client sees `localhost` as the issuer.
  const issuerUrl = new URL(OIDC_ISSUER);
  try {
    const execute: any[] = [];
    if (process.env.NODE_ENV !== "production") {
      execute.push(client.allowInsecureRequests);
    }
    
    config = await client.discovery(
      issuerUrl,
      CLIENT_ID,
      CLIENT_SECRET,
      undefined,
      execute.length > 0 ? { execute } : undefined
    );
    return config;
  } catch (err) {
    logger.error({ err }, "Failed to discover OIDC issuer");
    throw err;
  }
}

async function getKeycloakAdminToken() {
  const response = await fetch("http://keycloak:8080/auth/realms/master/protocol/openid-connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: process.env.KEYCLOAK_ADMIN || "admin",
      password: process.env.KEYCLOAK_ADMIN_PASSWORD || "admin"
    })
  });
  if (!response.ok) {
    const err = await response.text();
    logger.error({ err }, "Failed to get Keycloak admin token");
    throw new Error("Failed to get Keycloak admin token");
  }
  const data = await response.json();
  return data.access_token;
}

app.get("/api/oauth/login", async (req, res) => {
  try {
    const oidcConfig = await getOIDCConfig();
    const code_verifier = client.randomPKCECodeVerifier();
    const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
    const state = client.randomState();

    res.cookie("oauth_state", JSON.stringify({ state, code_verifier }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    const url = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: REDIRECT_URI,
      scope: OIDC_SCOPES,
      code_challenge,
      code_challenge_method: "S256",
      state,
    });

    res.redirect(url.href);
  } catch (err: any) {
    logger.error({ err }, "Failed to initialize login");
    res.status(500).json({ error: "Failed to initialize login" });
  }
});

app.get("/api/oauth/callback", async (req, res) => {
  try {
    const oidcConfig = await getOIDCConfig();
    const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
    
    const oauthStateCookie = req.cookies.oauth_state;
    if (!oauthStateCookie) {
      return res.redirect("/?error=missing_oauth_state");
    }
    const { state, code_verifier } = JSON.parse(oauthStateCookie);
    res.clearCookie("oauth_state");

    if (req.query.error) {
      logger.warn({ error: req.query.error, error_description: req.query.error_description }, "OAuth callback received an error from IdP");
      return res.redirect("/?error=" + encodeURIComponent(req.query.error as string));
    }

    const tokens = await client.authorizationCodeGrant(
      oidcConfig,
      currentUrl,
      {
        pkceCodeVerifier: code_verifier,
        expectedState: state,
      }
    );

    const claims = tokens.claims();
    if (!claims) {
      return res.status(400).json({ error: "No claims returned from ID token" });
    }

    const email = claims.email as string;
    const emailVerified = claims.email_verified as boolean;

    if (!email) {
      return res.status(400).json({ error: "No email provided by IdP" });
    }

    const localUserResult = await User.getByEmail(pgUserSource, email);
    const localUser = localUserResult && !('error' in localUserResult) ? localUserResult : null;

    if (!localUser) {
      if (emailVerified) {
        // Auto-register (trusting our Keycloak instance)
        const username = (claims.preferred_username as string) || email.split('@')[0] || "oauthuser";
        const randomPassword = Math.random().toString(36).slice(-8); // dummy password
        const createResult = await User.create(pgUserSource, username, email, randomPassword);
        if (createResult && 'error' in createResult) {
          return res.status(500).json({ error: "Failed to auto-register user" });
        }
        const newUser = createResult.user;
        await newUser.verifyEmail();
        await newUser.addValidatedHost(OIDC_ISSUER);

        issuePreemptSession(res, newUser);
        return res.redirect("/");
      } else {
        return res.status(403).json({ error: "Email not verified by IdP, cannot auto-register" });
      }
    } else {
      if (localUser.validated_hosts.includes(OIDC_ISSUER)) {
        issuePreemptSession(res, localUser);
        return res.redirect("/");
      } else {
        // Must link
        res.cookie("oauth_link", JSON.stringify({ email, issuer: OIDC_ISSUER }), { httpOnly: true, maxAge: 5 * 60 * 1000 });
        return res.redirect("/?link=true"); // Or wherever the frontend wants it
      }
    }
  } catch (err: any) {
    logger.error({ err }, "Callback failed");
    res.status(500).json({ error: "Callback failed" });
  }
});

app.get("/api/oauth/logout", async (req, res) => {
  try {
    const oidcConfig = await getOIDCConfig();
    
    // Attempt to use the end_session_endpoint if available, otherwise fallback to standard Keycloak logout URL
    let endSessionEndpoint = oidcConfig.serverMetadata().end_session_endpoint;
    if (!endSessionEndpoint) {
      endSessionEndpoint = `${OIDC_ISSUER}/protocol/openid-connect/logout`;
    }
    
    const logoutUrl = new URL(endSessionEndpoint);
    
    // Redirect back to the root of the app after logout
    const postLogoutRedirectUri = new URL("/", REDIRECT_URI).href;
    logoutUrl.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
    logoutUrl.searchParams.set("client_id", CLIENT_ID);

    let finalUrl = logoutUrl.href;
    if (process.env.NODE_ENV !== "production") {
      finalUrl = finalUrl.replace("http://localhost:8080", "http://localhost");
    }

    res.redirect(finalUrl);
  } catch (err: any) {
    logger.error({ err }, "Failed to initialize logout");
    res.status(500).json({ error: "Logout failed" });
  }
});

app.post("/api/oauth/link", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Not logged in locally" });
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch(err) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    if (!decoded.hasAuthenticated) {
       return res.status(401).json({ error: "Local session not fully authenticated" });
    }
    
    const linkCookie = req.cookies.oauth_link;
    if (!linkCookie) return res.status(400).json({ error: "No pending OAuth link context found" });
    const { email, issuer } = JSON.parse(linkCookie);
    
    if (email !== decoded.email) {
       return res.status(400).json({ error: "OAuth email does not match local session email" });
    }
    
    const user = await User.getByUsername(pgUserSource, decoded.username);
    if (!user || 'error' in user) return res.status(404).json({ error: "User not found" });
    
    await user.addValidatedHost(issuer);
    res.clearCookie("oauth_link");
    return res.json({ message: "Account successfully linked" });
  } catch (err: any) {
    logger.error({ err }, "Link failed");
    res.status(500).json({ error: "Link failed" });
  }
});

app.post("/api/oauth/register", async (req, res) => {
  try {
    const { email, password, firstName, lastName, username } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    
    const token = await getKeycloakAdminToken();
    const finalUsername = username || email.split('@')[0];

    const response = await fetch("http://keycloak:8080/auth/admin/realms/preempt/users", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: finalUsername,
        email: email,
        firstName: firstName || "",
        lastName: lastName || "",
        enabled: true,
        credentials: [{
          type: "password",
          value: password,
          temporary: false
        }]
      })
    });

    if (!response.ok) {
      if (response.status === 409) return res.status(409).json({ error: "User already exists" });
      const err = await response.text();
      logger.error({ err }, "Failed to create user in Keycloak");
      return res.status(500).json({ error: "Failed to register user" });
    }

    return res.json({ message: "Registration successful" });
  } catch (err) {
    logger.error({ err }, "Registration failed");
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/oauth/reset-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const token = await getKeycloakAdminToken();

    // 1. Get user ID
    const userRes = await fetch(`http://keycloak:8080/auth/admin/realms/preempt/users?email=${encodeURIComponent(email)}`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!userRes.ok) throw new Error("Failed to search users");
    const users = await userRes.json();
    
    if (!users || users.length === 0) {
      // Return success anyway to prevent email enumeration
      return res.json({ message: "If that email exists, a password reset link has been sent." });
    }

    const userId = users[0].id;

    // 2. Trigger execute-actions-email
    const actionRes = await fetch(`http://keycloak:8080/auth/admin/realms/preempt/users/${userId}/execute-actions-email`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["UPDATE_PASSWORD"])
    });

    if (!actionRes.ok) {
      const err = await actionRes.text();
      logger.error({ err }, "Failed to trigger password reset email");
      return res.status(500).json({ error: "Failed to send password reset email" });
    }

    return res.json({ message: "If that email exists, a password reset link has been sent." });
  } catch (err) {
    logger.error({ err }, "Password reset failed");
    return res.status(500).json({ error: "Password reset failed" });
  }
});

app.listen(PORT, () => {
  logger.info(`OAuth worker running on port ${PORT}`);
});
