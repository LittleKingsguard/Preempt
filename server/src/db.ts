import { Pool } from "pg";
import dotenv from "dotenv";

import { logger } from "./utils/logger.js";

dotenv.config();

const password = process.env.PGPASSWORD || "preemptpassword";

if (process.env.NODE_ENV === 'production' && password === "preemptpassword") {
  logger.error("Default PostgreSQL password is being used in production. This is highly insecure. Exiting...");
  process.exit(1);
}

export const pool = new Pool({
  user: process.env.PGUSER || "preempt",
  password,
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT || "5432", 10),
  database: process.env.PGDATABASE || "preempt",
});
