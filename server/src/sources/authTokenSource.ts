import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import type { IAuthTokenSource } from "../models/interfaces.js";

export async function dbCreateAuthToken(username: string, type: string, tokenValue: string, expiresInMinutes: number) {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);
  await pool.query(
    "INSERT INTO AuthTokens (username, token_type, token_hash, expires_at) VALUES ($1, $2, crypt($3, gen_salt('bf')), $4)",
    [username, type, tokenValue, expiresAt]
  );
}

export async function dbVerifyAuthToken(username: string, type: string, tokenValue: string) {
  return await queryFirstRow(
    "SELECT id FROM AuthTokens WHERE username = $1 AND token_type = $2 AND token_hash = crypt($3, token_hash) AND expires_at > CURRENT_TIMESTAMP",
    [username, type, tokenValue]
  );
}

export async function dbDeleteAuthTokens(username: string, type: string) {
  await pool.query("DELETE FROM AuthTokens WHERE username = $1 AND token_type = $2", [username, type]);
}

export const pgAuthTokenSource: IAuthTokenSource = {
  create: dbCreateAuthToken,
  verify: dbVerifyAuthToken,
  delete: dbDeleteAuthTokens
};
