import express from "express";
import jwt from "jsonwebtoken";
import { authenticateUser } from "../models/user.js";
import { JWT_SECRET } from "../middleware/auth.js";

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

export default router;
