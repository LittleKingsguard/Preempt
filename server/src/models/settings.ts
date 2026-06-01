import { pool } from "../db.js";

interface CacheEntry {
  value: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute cache

export async function getSetting(key: string): Promise<any> {
  const now = Date.now();
  const cached = cache.get(key);
  
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }

  const result = await pool.query("SELECT value FROM SiteSettings WHERE key = $1", [key]);
  const value = result.rows.length > 0 ? result.rows[0].value : null;
  
  cache.set(key, { value, timestamp: now });
  return value;
}

export async function setSetting(key: string, value: any): Promise<void> {
  await pool.query(`
    INSERT INTO SiteSettings (key, value, updated_at) 
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [key, JSON.stringify(value)]);
  
  cache.set(key, { value, timestamp: Date.now() });
}
