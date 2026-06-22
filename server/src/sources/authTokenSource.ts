import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import type { IAuthTokenSource } from "../models/interfaces.js";

export async function dbCreateAuthToken(event: IPreemptEvent, username: string, type: string, tokenValue: string, expiresInMinutes: number) {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);
  const cte = getLogEventCTE(event, 5);
  await pool.query(
    `WITH inserted AS (
       INSERT INTO AuthTokens (username, token_type, token_hash, expires_at) VALUES ($1, $2, crypt($3, gen_salt('bf')), $4)
     ),
     ${cte.sql}
     SELECT 1`,
    [username, type, tokenValue, expiresAt, ...cte.params]
  );
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
  const cte = getLogEventCTE(event, 3);
  await pool.query(
    `WITH deleted AS (
       DELETE FROM AuthTokens WHERE username = $1 AND token_type = $2
     ),
     ${cte.sql}
     SELECT 1`,
    [username, type, ...cte.params]
  );
}

export const pgAuthTokenSource: IAuthTokenSource = {
  create: dbCreateAuthToken,
  verify: dbVerifyAuthToken,
  delete: dbDeleteAuthTokens
};
