import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, logEvent, fireAndForgetEvent } from "../utils/db.js";

export async function dbGetSetting(event: IPreemptEvent, key: string) {
  const row = await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", [key]);
  fireAndForgetEvent(event);
  return row;
}

export async function dbSetSetting(event: IPreemptEvent, key: string, valueStr: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO SiteSettings (key, value, updated_at) 
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `, [key, valueStr]);
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

import type { ISettingSource } from "../models/interfaces.js";
export const pgSettingSource: ISettingSource = {
  get: dbGetSetting,
  set: dbSetSetting
};
