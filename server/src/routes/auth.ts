import express from "express";
import jwt from "jsonwebtoken";
import { authenticateUser, createUser } from "../models/user.js";
import { JWT_SECRET, authenticateToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await authenticateUser(username, password);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false }); // secure: false for local dev
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
    if (user.error) {
      return res.status(400).json({ error: user.error });
    }

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false }); // secure: false for local dev
    res.json({ message: "Registered successfully", user });
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
