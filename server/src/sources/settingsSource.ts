import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function dbGetSetting(key: string) {
  return await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", [key]);
}

export async function dbSetSetting(key: string, valueStr: string) {
  await pool.query(`
    INSERT INTO SiteSettings (key, value, updated_at) 
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `, [key, valueStr]);
}

import type { ISettingSource } from "../models/interfaces.js";
export const pgSettingSource: ISettingSource = {
  get: dbGetSetting,
  set: dbSetSetting
};
