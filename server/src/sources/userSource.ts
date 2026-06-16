import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, logEvent, fireAndForgetEvent } from "../utils/db.js";

export async function dbAuthenticateUser(event: IPreemptEvent, username: string, passwordPlain: string) {
  const row = await queryFirstRow(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
    [username, passwordPlain]
  );
  fireAndForgetEvent(event);
  return row;
}

export async function dbCreateUser(event: IPreemptEvent, username: string, email: string, passwordPlain: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO Users (username, email, password_hash, is_shadowed, has_verified) VALUES ($1, $2, crypt($3, gen_salt('bf')), true, false) RETURNING username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page",
      [username, email, passwordPlain]
    );
    await logEvent(client, event);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return { error: "Username or email already exists", status: 409 };
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function dbGetUserByEmail(event: IPreemptEvent, email: string) {
  const row = await queryFirstRow("SELECT username, email, is_admin FROM Users WHERE email = $1", [email], "User not found");
  fireAndForgetEvent(event);
  return row;
}

export async function dbGetUserByUsername(event: IPreemptEvent, username: string) {
  const row = await queryFirstRow("SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page FROM Users WHERE username = $1", [username], "User not found");
  fireAndForgetEvent(event);
  return row;
}

export async function dbUpdatePassword(event: IPreemptEvent, username: string, newPasswordPlain: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE Users SET password_hash = crypt($1, gen_salt('bf')) WHERE username = $2", [newPasswordPlain, username]);
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}



export async function dbVerifyUserEmail(event: IPreemptEvent, username: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE Users SET is_shadowed = false, has_verified = true WHERE username = $1", [username]);
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dbUpdateUserRoles(event: IPreemptEvent, username: string, roles: { is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE Users SET ${updates.join(', ')} WHERE username = $${index}`,
      values
    );
    await logEvent(client, event);
    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23514' && err.constraint === 'check_bot_roles') {
      return { error: "A bot cannot have admin or contributor roles", status: 400 };
    }
    if (err.code === '23514' && err.constraint === 'check_verified_roles') {
      return { error: "User must verify their email before receiving admin or contributor roles", status: 400 };
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function dbUpdateUserHomePage(event: IPreemptEvent, username: string, homePage: number | null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE Users SET home_page = $1 WHERE username = $2",
      [homePage, username]
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

export async function dbGetUsers(event: IPreemptEvent) {
  const result = await pool.query(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page FROM Users"
  );
  fireAndForgetEvent(event);
  return result.rows;
}

import type { IUserSource } from "../models/interfaces.js";
export const pgUserSource: IUserSource = {
  authenticate: dbAuthenticateUser,
  create: dbCreateUser,
  getByEmail: dbGetUserByEmail,
  getByUsername: dbGetUserByUsername,
  updatePassword: dbUpdatePassword,
  verifyEmail: dbVerifyUserEmail,
  updateRoles: dbUpdateUserRoles,
  updateHomePage: dbUpdateUserHomePage,
  getAll: dbGetUsers
};
