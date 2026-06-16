import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, logEvent, fireAndForgetEvent } from "../utils/db.js";
import type { IAuthTokenSource } from "../models/interfaces.js";

export async function dbCreateAuthToken(event: IPreemptEvent, username: string, type: string, tokenValue: string, expiresInMinutes: number) {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO AuthTokens (username, token_type, token_hash, expires_at) VALUES ($1, $2, crypt($3, gen_salt('bf')), $4)",
      [username, type, tokenValue, expiresAt]
    );
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbVerifyAuthToken(event: IPreemptEvent, username: string, type: string, tokenValue: string) {
  const res = await queryFirstRow(
    "SELECT id FROM AuthTokens WHERE username = $1 AND token_type = $2 AND token_hash = crypt($3, token_hash) AND expires_at > CURRENT_TIMESTAMP",
    [username, type, tokenValue]
  );
  fireAndForgetEvent(event);
  return res;
}

export async function dbDeleteAuthTokens(event: IPreemptEvent, username: string, type: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM AuthTokens WHERE username = $1 AND token_type = $2", [username, type]);
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const pgAuthTokenSource: IAuthTokenSource = {
  create: dbCreateAuthToken,
  verify: dbVerifyAuthToken,
  delete: dbDeleteAuthTokens
};
