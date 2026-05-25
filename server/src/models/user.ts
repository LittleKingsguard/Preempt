import { pool } from "../db.js";

export async function authenticateUser(username: string, passwordPlain: string) {
  const result = await pool.query(
    "SELECT username, is_admin, is_contributor FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
    [username, passwordPlain]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}
