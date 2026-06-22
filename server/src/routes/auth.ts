import { logger } from "../utils/logger.js";
import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/user.js";
import { JWT_SECRET, authenticateToken } from "../middleware/auth.js";

import { pgUserSource } from "../sources/userSource.js";
import { pgAuthTokenSource } from "../sources/authTokenSource.js";

const router = express.Router();

async function generateAndSendCode(res: express.Response, username: string, email: string, type: string) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await User.deleteAuthTokens(pgAuthTokenSource, username, type);
  
  switch (type) {
    case 'VERIFY':
      await User.createAuthToken(pgAuthTokenSource, username, 'VERIFY', code, 60);
      return res.json({ status: "verification_required", username });
    case '2FA':
      await User.createAuthToken(pgAuthTokenSource, username, '2FA', code, 15);
      return res.json({ status: "2fa_required", username });
    default:
      return res.status(400).json({ error: "Invalid token type requested" });
  }
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.authenticate(pgUserSource, username, password);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    let hasAuthenticated = true;
    let authRequirement = null;

    if (user.has_verified === false) {
      hasAuthenticated = false;
      authRequirement = 'VERIFY';
    } else if ((user.is_admin || user.is_2fa_enabled) && process.env.NODE_ENV !== 'test') {
      hasAuthenticated = false;
      authRequirement = '2FA';
    }

    (user as any).hasAuthenticated = hasAuthenticated;
    const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false }); // secure: false for local dev

    if (authRequirement) {
      return await generateAndSendCode(res, user.username, user.email, authRequirement);
    }

    res.json({ message: "Logged in successfully", user });
  } catch (err) {
    logger.error({ err: err }, "LOGIN ERROR:");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-2fa", async (req, res) => {
  const { username, code } = req.body;
  try {
    const isValid = await User.verifyAuthToken(pgAuthTokenSource, username, '2FA', code);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid or expired 2FA code" });
    }

    await User.deleteAuthTokens(pgAuthTokenSource, username, '2FA');
    const user = await User.getByUsername(pgUserSource, username);

    if (!user) {
       return res.status(404).json({ error: "User not found" });
    }

    (user as any).hasAuthenticated = true;
    const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false });
    res.json({ message: "Logged in successfully", user });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Username, email, and password are required" });
  }

  try {
    const userRes = await User.create(pgUserSource, username, email, password);
    if ((userRes as any).error) {
      return res.status(400).json({ error: (userRes as any).error });
    }
    const user = (userRes as any).user;

    (user as any).hasAuthenticated = false;
    const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
    res.cookie("token", token, { httpOnly: true, secure: false });

    return await generateAndSendCode(res, user.username, user.email, 'VERIFY');
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-email", async (req, res) => {
  const username = req.body.username;
  const code = (req.body.code || "").trim();
  
  try {
    const isValid = await User.verifyAuthToken(pgAuthTokenSource, username, 'VERIFY', code);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    await User.deleteAuthTokens(pgAuthTokenSource, username, 'VERIFY');
    const user = await User.getByUsername(pgUserSource, username);
    if (user) {
      await user.verifyEmail();
      (user as any).hasAuthenticated = true;
      const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
      
      res.cookie("token", token, { httpOnly: true, secure: false });
      res.json({ message: "Email verified and logged in successfully", user });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.getByEmail(pgUserSource, email);
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      await User.deleteAuthTokens(pgAuthTokenSource, user.username, 'RESET');
      await User.createAuthToken(pgAuthTokenSource, user.username, 'RESET', resetToken, 30);
    }
    // Always return 200 to avoid email enumeration
    res.json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { username, token, new_password } = req.body;
  try {
    const isValid = await User.verifyAuthToken(pgAuthTokenSource, username, 'RESET', token);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const user = await User.getByUsername(pgUserSource, username);
    if (user) await user.updatePassword(new_password);
    await User.deleteAuthTokens(pgAuthTokenSource, username, 'RESET');

    res.json({ message: "Password has been successfully reset" });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/change-password", authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  const username = (req as any).user?.username;

  if (!username) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await User.authenticate(pgUserSource, username, current_password);
    if (!user) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    await user.updatePassword(new_password);
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/update-home-page", authenticateToken, async (req, res) => {
  const { home_page } = req.body;
  const username = (req as any).user?.username;

  if (!username) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await User.getByUsername(pgUserSource, username);
    if (user) {
      await user.updateHomePage(home_page === undefined ? null : home_page);
      (user as any).hasAuthenticated = true;
      const token = jwt.sign(Object.assign({}, user), JWT_SECRET, { expiresIn: "24h" });
      
      res.cookie("token", token, { httpOnly: true, secure: false });
      res.json({ message: "Home page updated successfully", user });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    logger.error({ err }, "An error occurred");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", authenticateToken, (req, res) => {
  const user = (req as any).user;
  res.json({ user });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
});

export default router;
