import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function authenticateUser(username: string, passwordPlain: string) {
  return await queryFirstRow(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
    [username, passwordPlain]
  );
}

export async function createUser(username: string, email: string, passwordPlain: string) {
  try {
    const result = await pool.query(
      "INSERT INTO Users (username, email, password_hash, is_shadowed, has_verified) VALUES ($1, $2, crypt($3, gen_salt('bf')), true, false) RETURNING username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page",
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

export async function getUserByEmail(email: string) {
  return await queryFirstRow("SELECT username, email, is_admin FROM Users WHERE email = $1", [email]);
}

export async function getUserByUsername(username: string) {
  return await queryFirstRow("SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page FROM Users WHERE username = $1", [username]);
}

export async function updatePassword(username: string, newPasswordPlain: string) {
  await pool.query("UPDATE Users SET password_hash = crypt($1, gen_salt('bf')) WHERE username = $2", [newPasswordPlain, username]);
}

export async function createAuthToken(username: string, type: string, tokenValue: string, expiresInMinutes: number) {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);
  await pool.query(
    "INSERT INTO AuthTokens (username, token_type, token_hash, expires_at) VALUES ($1, $2, crypt($3, gen_salt('bf')), $4)",
    [username, type, tokenValue, expiresAt]
  );
}

export async function verifyAuthToken(username: string, type: string, tokenValue: string) {
  return await queryFirstRow(
    "SELECT id FROM AuthTokens WHERE username = $1 AND token_type = $2 AND token_hash = crypt($3, token_hash) AND expires_at > CURRENT_TIMESTAMP",
    [username, type, tokenValue]
  );
}

export async function deleteAuthTokens(username: string, type: string) {
  await pool.query("DELETE FROM AuthTokens WHERE username = $1 AND token_type = $2", [username, type]);
}

export async function verifyUserEmail(username: string) {
  await pool.query("UPDATE Users SET is_shadowed = false, has_verified = true WHERE username = $1", [username]);
}

export async function updateUserRoles(username: string, roles: { is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
  const updates: string[] = [];
  const values: any[] = [];
  let index = 1;
  
  if (roles.is_contributor !== undefined) {
    updates.push(`is_contributor = $${index++}`);
    values.push(roles.is_contributor);
  }
  if (roles.is_bot !== undefined) {
    updates.push(`is_bot = $${index++}`);
    values.push(roles.is_bot);
  }
  if (roles.is_shadowed !== undefined) {
    updates.push(`is_shadowed = $${index++}`);
    values.push(roles.is_shadowed);
  }

  if (updates.length === 0) return;

  values.push(username);
  await pool.query(
    `UPDATE Users SET ${updates.join(', ')} WHERE username = $${index}`,
    values
  );
}

export async function updateUserHomePage(username: string, homePage: number | null) {
  await pool.query(
    "UPDATE Users SET home_page = $1 WHERE username = $2",
    [homePage, username]
  );
}

export async function getUsers() {
  const result = await pool.query(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page FROM Users"
  );
  return result.rows;
}
