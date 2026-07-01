import { Pool } from "pg";
import dotenv from "dotenv";

import path from "path";
import { logger } from "./utils/logger.js";

const envKeys = ['JWT_SECRET', 'OIDC_CLIENT_SECRET', 'KEYCLOAK_ADMIN', 'KEYCLOAK_ADMIN_PASSWORD'];
const parsed = dotenv.config({ path: path.join(process.cwd(), ".env"), override: true }).parsed || {};
for (const key of envKeys) {
  if (!(key in parsed)) {
    delete process.env[key];
  }
}

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
