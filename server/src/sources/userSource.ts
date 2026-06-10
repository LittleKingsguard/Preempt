import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";

export async function dbAuthenticateUser(username: string, passwordPlain: string) {
  return await queryFirstRow(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
    [username, passwordPlain]
  );
}

export async function dbCreateUser(username: string, email: string, passwordPlain: string) {
  try {
    return await queryFirstRow(
      "INSERT INTO Users (username, email, password_hash, is_shadowed, has_verified) VALUES ($1, $2, crypt($3, gen_salt('bf')), true, false) RETURNING username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page",
      [username, email, passwordPlain]
    );
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Username or email already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbGetUserByEmail(email: string) {
  return await queryFirstRow("SELECT username, email, is_admin FROM Users WHERE email = $1", [email], "User not found");
}

export async function dbGetUserByUsername(username: string) {
  return await queryFirstRow("SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page FROM Users WHERE username = $1", [username], "User not found");
}

export async function dbUpdatePassword(username: string, newPasswordPlain: string) {
  await pool.query("UPDATE Users SET password_hash = crypt($1, gen_salt('bf')) WHERE username = $2", [newPasswordPlain, username]);
}



export async function dbVerifyUserEmail(username: string) {
  await pool.query("UPDATE Users SET is_shadowed = false, has_verified = true WHERE username = $1", [username]);
}

export async function dbUpdateUserRoles(username: string, roles: { is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
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
  try {
    await pool.query(
      `UPDATE Users SET ${updates.join(', ')} WHERE username = $${index}`,
      values
    );
  } catch (err: any) {
    if (err.code === '23514' && err.constraint === 'check_bot_roles') {
      return { error: "A bot cannot have admin or contributor roles", status: 400 };
    }
    if (err.code === '23514' && err.constraint === 'check_verified_roles') {
      return { error: "User must verify their email before receiving admin or contributor roles", status: 400 };
    }
    throw err;
  }
}

export async function dbUpdateUserHomePage(username: string, homePage: number | null) {
  await pool.query(
    "UPDATE Users SET home_page = $1 WHERE username = $2",
    [homePage, username]
  );
}

export async function dbGetUsers() {
  const result = await pool.query(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page FROM Users"
  );
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
