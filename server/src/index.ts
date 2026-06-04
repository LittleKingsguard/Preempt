import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { initTagCache } from "./models/tag.js";

import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import mcpRoutes from "./routes/mcp.js";
import ssrRoutes from "./routes/ssr.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Initialize cache
initTagCache();

// Mount routers
app.use("/api", authRoutes);
app.use("/api", apiRoutes);
app.use("/api/mcp", mcpRoutes);
app.use("/", ssrRoutes);

// Serve static assets from dist
app.use(express.static(path.join(process.cwd(), "../dist"), { index: false }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
