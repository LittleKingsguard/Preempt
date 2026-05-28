import { pool } from "../db.js";

export async function authenticateUser(username: string, passwordPlain: string) {
  const result = await pool.query(
    "SELECT username, is_admin, is_contributor FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
    [username, passwordPlain]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function createUser(username: string, email: string, passwordPlain: string) {
  try {
    const result = await pool.query(
      "INSERT INTO Users (username, email, password_hash) VALUES ($1, $2, crypt($3, gen_salt('bf'))) RETURNING username, email, is_admin, is_contributor",
      [username, email, passwordPlain]
    );
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') { // Unique constraint violation
      return { error: "Username or email already exists" };
    }
    throw err;
  }
}
