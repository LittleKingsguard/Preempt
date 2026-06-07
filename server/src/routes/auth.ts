import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { authenticateUser, createUser, getUserByEmail, getUserByUsername, updatePassword, createAuthToken, verifyAuthToken, deleteAuthTokens, verifyUserEmail, updateUserHomePage } from "../models/user.js";
import { JWT_SECRET, authenticateToken } from "../middleware/auth.js";
import { sendPasswordResetEmail, send2FAEmail, sendVerificationEmail } from "../utils/email.js";

const router = express.Router();

async function generateAndSendCode(res: express.Response, username: string, email: string, type: string) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await deleteAuthTokens(username, type);
  
  switch (type) {
    case 'VERIFY':
      await createAuthToken(username, 'VERIFY', code, 60);
      await sendVerificationEmail(email, code);
      return res.json({ status: "verification_required", username });
    case '2FA':
      await createAuthToken(username, '2FA', code, 15);
      await send2FAEmail(email, code);
      return res.json({ status: "2fa_required", username });
    default:
      return res.status(400).json({ error: "Invalid token type requested" });
  }
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await authenticateUser(username, password);

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

    user.hasAuthenticated = hasAuthenticated;
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false }); // secure: false for local dev

    if (authRequirement) {
      return await generateAndSendCode(res, user.username, user.email, authRequirement);
    }

    res.json({ message: "Logged in successfully", user });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-2fa", async (req, res) => {
  const { username, code } = req.body;
  try {
    const isValid = await verifyAuthToken(username, '2FA', code);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid or expired 2FA code" });
    }

    await deleteAuthTokens(username, '2FA');
    const user = await getUserByUsername(username);

    if (!user) {
       return res.status(404).json({ error: "User not found" });
    }

    user.hasAuthenticated = true;
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false });
    res.json({ message: "Logged in successfully", user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Username, email, and password are required" });
  }

  try {
    const user = await createUser(username, email, password);
    if ((user as any).error) {
      return res.status(400).json({ error: (user as any).error });
    }

    user.hasAuthenticated = false;
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("token", token, { httpOnly: true, secure: false });

    return await generateAndSendCode(res, user.username, user.email, 'VERIFY');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-email", async (req, res) => {
  const username = req.body.username;
  const code = (req.body.code || "").trim();
  
  try {
    const isValid = await verifyAuthToken(username, 'VERIFY', code);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    await deleteAuthTokens(username, 'VERIFY');
    await verifyUserEmail(username);

    const user = await getUserByUsername(username);
    user.hasAuthenticated = true;
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false });
    res.json({ message: "Email verified and logged in successfully", user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await getUserByEmail(email);
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      await deleteAuthTokens(user.username, 'RESET');
      await createAuthToken(user.username, 'RESET', resetToken, 30);
      await sendPasswordResetEmail(user.email, user.username, resetToken);
    }
    // Always return 200 to avoid email enumeration
    res.json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { username, token, new_password } = req.body;
  try {
    const isValid = await verifyAuthToken(username, 'RESET', token);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    await updatePassword(username, new_password);
    await deleteAuthTokens(username, 'RESET');

    res.json({ message: "Password has been successfully reset" });
  } catch (err) {
    console.error(err);
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
    const user = await authenticateUser(username, current_password);
    if (!user) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    await updatePassword(username, new_password);
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error(err);
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
    await updateUserHomePage(username, home_page === undefined ? null : home_page);
    
    const user = await getUserByUsername(username);
    user.hasAuthenticated = true;
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false });
    res.json({ message: "Home page updated successfully", user });
  } catch (err) {
    console.error(err);
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
