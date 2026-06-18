import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import * as client from "openid-client";
import { User } from "../models/user.js";
import { pgUserSource } from "../sources/userSource.js";

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.json());

const PORT = process.env.OAUTH_PORT || 3002;
const OIDC_ISSUER = process.env.OIDC_ISSUER || "http://keycloak:8080/realms/preempt";
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "preempt-app";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "secret";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || "http://localhost/api/oauth/callback";
const OIDC_SCOPES = process.env.OIDC_SCOPES || "openid email profile";

let config: client.Configuration;

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "default_dev_secret_change_me_in_prod";

// Helper to issue JWT
function issuePreemptSession(res: express.Response, user: any) {
  (user as any).hasAuthenticated = true;
  const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

async function getOIDCConfig() {
  if (config) return config;
  const issuerUrl = new URL(OIDC_ISSUER);
  try {
    config = await client.discovery(
      issuerUrl,
      CLIENT_ID,
      CLIENT_SECRET
    );
    return config;
  } catch (err) {
    console.error("Failed to discover OIDC issuer", err);
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
    console.error("Failed to get Keycloak admin token", err);
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
    console.error(err);
    res.status(500).json({ error: "Failed to initialize login" });
  }
});

app.get("/api/oauth/callback", async (req, res) => {
  try {
    const oidcConfig = await getOIDCConfig();
    const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
    
    const oauthStateCookie = req.cookies.oauth_state;
    if (!oauthStateCookie) {
      return res.status(400).json({ error: "Missing OAuth state cookie" });
    }
    const { state, code_verifier } = JSON.parse(oauthStateCookie);
    res.clearCookie("oauth_state");

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
        // Auto-register
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
    console.error(err);
    res.status(500).json({ error: "Callback failed" });
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
    console.error(err);
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
      console.error("Failed to create user in Keycloak", err);
      return res.status(500).json({ error: "Failed to register user" });
    }

    return res.json({ message: "Registration successful" });
  } catch (err) {
    console.error(err);
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
      console.error("Failed to trigger password reset email", err);
      return res.status(500).json({ error: "Failed to send password reset email" });
    }

    return res.json({ message: "If that email exists, a password reset link has been sent." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Password reset failed" });
  }
});

app.listen(PORT, () => {
  console.log(`OAuth worker running on port ${PORT}`);
});
