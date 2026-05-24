import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// --- MIDDLEWARE ---
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// --- AUTH ROUTES ---
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT username, is_admin, is_contributor FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "24h" });
    
    res.cookie("token", token, { httpOnly: true, secure: false }); // secure: false for local dev
    res.json({ message: "Logged in successfully", user });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- API ROUTES ---
app.get("/api/content/:id", authenticateToken, async (req, res) => {
  const contentId = parseInt(req.params.id as string, 10);
  const templateId = req.query.templateId ? parseInt(req.query.templateId as string, 10) : null;
  const user = (req as any).user;

  try {
    let query = `
      SELECT c.*, t.payload as template_payload
      FROM Content c
      JOIN ContentTemplates ct ON c.id = ct.content_id
      JOIN Templates t ON ct.template_id = t.id
      WHERE c.id = $1
    `;
    const params: any[] = [contentId];

    if (templateId) {
      query += ` AND t.id = $2`;
      params.push(templateId);
    } else {
      query += ` LIMIT 1`;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Content or associated Template not found" });
    }

    const content = result.rows[0];

    // Access Control
    const isAuthor = user?.username === content.author_id;
    const isAdmin = user?.is_admin === true;
    const now = new Date();

    if (!isAuthor && !isAdmin) {
      if (!content.is_visible) {
        return res.status(403).json({ error: "Forbidden: Content is not visible" });
      }
      if (content.live_date && new Date(content.live_date) > now) {
        return res.status(403).json({ error: "Forbidden: Content is not live yet" });
      }
    }

    res.json({
      template: content.template_payload,
      content: content.payload
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/template/:id", authenticateToken, async (req, res) => {
  const templateId = parseInt(req.params.id as string, 10);

  try {
    const result = await pool.query("SELECT * FROM Templates WHERE id = $1", [templateId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- SSR HTML SERVING ---
app.get("/content/:id", async (req, res) => {
  const contentId = parseInt(req.params.id, 10);
  try {
    const result = await pool.query("SELECT headers FROM Content WHERE id = $1", [contentId]);
    if (result.rows.length === 0) {
      return res.status(404).send("Content not found");
    }
    const headers = result.rows[0].headers || "";

    const distPath = path.join(process.cwd(), "../dist/index.html");
    if (!fs.existsSync(distPath)) {
      return res.status(500).send("Frontend dist not found. Did you run npm run build?");
    }

    let html = fs.readFileSync(distPath, "utf-8");
    html = html.replace("<!-- HEADERS_INJECT -->", headers);
    
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

// Serve static assets from dist
app.use(express.static(path.join(process.cwd(), "../dist"), { index: false }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
