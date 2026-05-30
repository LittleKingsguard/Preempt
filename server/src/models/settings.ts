import { pool } from "../db.js";

export async function getSetting(key: string): Promise<any> {
  const result = await pool.query("SELECT value FROM SiteSettings WHERE key = $1", [key]);
  return result.rows.length > 0 ? result.rows[0].value : null;
}

export async function setSetting(key: string, value: any): Promise<void> {
  await pool.query(`
    INSERT INTO SiteSettings (key, value, updated_at) 
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [key, JSON.stringify(value)]);
}
