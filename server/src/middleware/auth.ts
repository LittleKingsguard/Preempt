import express from "express";
import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies?.token;
  if (!token) {
    (req as any).user = null;
    return next();
  }
  try {
    const user = jwt.verify(token, JWT_SECRET);
    (req as any).user = user;
    next();
  } catch (err) {
    (req as any).user = null;
    next();
  }
};

export const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!(req as any).user || !(req as any).user.is_admin) {
    res.status(403).json({ error: "Forbidden: Admin access required" });
    return;
  }
  next();
};

import { authenticateUser } from "../models/user.js";

export const mcpAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.status(401).json({ error: "Unauthorized: Missing Basic Auth" });
    return;
  }

  const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
  const [username, password] = credentials.split(':');

  if (!username || !password) {
    res.status(401).json({ error: "Unauthorized: Invalid Basic Auth format" });
    return;
  }

  try {
    const user = await authenticateUser(username, password);
    if (!user) {
      res.status(401).json({ error: "Unauthorized: Invalid credentials" });
      return;
    }
    if (!user.is_bot) {
      res.status(403).json({ error: "Forbidden: Must be a bot to use this endpoint" });
      return;
    }

    (req as any).user = user;
    next();
  } catch (err) {
    console.error("mcpAuth error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
