import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger.js";
import { Tag } from "./models/tag.js";
import { initWebSocket } from "./workers/websocketManager.js";
import { pool } from "./db.js";

import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import mcpRoutes from "./routes/mcp.js";
import ssrRoutes from "./routes/ssr.js";

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({ 
  origin: (origin, callback) => {
    // Allow if origin is undefined (e.g. mobile apps, curl)
    // Allow if in development environment
    // Allow if it's explicitly in the ALLOWED_ORIGINS list
    if (!origin || process.env.NODE_ENV === 'development' || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }, 
  credentials: true 
}));

app.use((pinoHttp as any)({ logger }));
app.use(express.json());
app.use(cookieParser());

// Initialize cache
Tag.initCache();

// Mount routers
app.use("/api", authRoutes);
app.use("/api", apiRoutes);
app.use("/api/mcp", mcpRoutes);
app.use("/", ssrRoutes);

// Serve static assets from dist
app.use(express.static(path.join(process.cwd(), "../dist"), { index: false }));

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error({ err, req }, 'Unhandled Express error');
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

const wsManager = initWebSocket(server);

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  try {
    await wsManager.shutdown();
  } catch (err) {
    logger.error({ err }, 'Error during WebSocket shutdown');
  }

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await pool.end();
      logger.info('Database pool closed');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during database pool closure');
      process.exit(1);
    }
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
