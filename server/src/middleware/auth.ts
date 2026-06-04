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

export function validateUserRoles(user: any, permittedRoles: string[], creatorUsername?: string): { error: string, status: number } | null {
  if (!user) return { error: "Unauthorized", status: 401 };
  if (user.has_verified === false) return { error: "Please verify your email to perform this action", status: 403 };

  let isAuthorized = false;
  if (permittedRoles.includes("admin") && user.is_admin) isAuthorized = true;
  if (permittedRoles.includes("contributor") && user.is_contributor) isAuthorized = true;
  if (permittedRoles.includes("trusted_dev") && user.is_trusted_dev) isAuthorized = true;
  if (permittedRoles.includes("author") && creatorUsername && user.username === creatorUsername) isAuthorized = true;

  if (!isAuthorized) {
    const rolesStr = permittedRoles.join(", ");
    return { error: `Forbidden: Must be one of: ${rolesStr}`, status: 403 };
  }

  return null;
}
