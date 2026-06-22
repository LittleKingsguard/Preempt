import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";

export async function dbAuthenticateUser(event: IPreemptEvent, username: string, passwordPlain: string) {
  const row = await queryFirstRow(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page, validated_hosts FROM Users WHERE username = $1 AND password_hash = crypt($2, password_hash)",
    [username, passwordPlain]
  );
  fireAndForgetEvent(event);
  return row;
}

export async function dbCreateUser(event: IPreemptEvent, username: string, email: string, passwordPlain: string) {
  const cte = getLogEventCTE(event, 4);
  try {
    const result = await pool.query(
      `WITH inserted AS (
         INSERT INTO Users (username, email, password_hash, is_shadowed, has_verified, validated_hosts) 
         VALUES ($1, $2, crypt($3, gen_salt('bf')), true, false, '{}'::text[]) 
         RETURNING username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page, validated_hosts
       ),
       ${cte.sql}
       SELECT * FROM inserted`,
      [username, email, passwordPlain, ...cte.params]
    );
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Username or email already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbGetUserByEmail(event: IPreemptEvent, email: string) {
  const row = await queryFirstRow("SELECT username, email, is_admin, validated_hosts FROM Users WHERE email = $1", [email], "User not found");
  fireAndForgetEvent(event);
  return row;
}

export async function dbGetUserByUsername(event: IPreemptEvent, username: string) {
  const row = await queryFirstRow("SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page, validated_hosts FROM Users WHERE username = $1", [username], "User not found");
  fireAndForgetEvent(event);
  return row;
}

export async function dbUpdatePassword(event: IPreemptEvent, username: string, newPasswordPlain: string) {
  const cte = getLogEventCTE(event, 3);
  await pool.query(
    `WITH updated AS (
       UPDATE Users SET password_hash = crypt($1, gen_salt('bf')) WHERE username = $2 RETURNING username
     ),
     ${cte.sql}
     SELECT 1`,
    [newPasswordPlain, username, ...cte.params]
  );
}

export async function dbVerifyUserEmail(event: IPreemptEvent, username: string) {
  const cte = getLogEventCTE(event, 2);
  await pool.query(
    `WITH updated AS (
       UPDATE Users SET is_shadowed = false, has_verified = true WHERE username = $1 RETURNING username
     ),
     ${cte.sql}
     SELECT 1`,
    [username, ...cte.params]
  );
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
  const usernameIndex = index;
  index++; // for CTE params

  const cte = getLogEventCTE(event, index);

  try {
    await pool.query(
      `WITH updated AS (
         UPDATE Users SET ${updates.join(', ')} WHERE username = $${usernameIndex} RETURNING username
       ),
       ${cte.sql}
       SELECT 1`,
      [...values, ...cte.params]
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

export async function dbUpdateUserHomePage(event: IPreemptEvent, username: string, homePage: number | null) {
  const cte = getLogEventCTE(event, 3);
  await pool.query(
    `WITH updated AS (
       UPDATE Users SET home_page = $1 WHERE username = $2 RETURNING username
     ),
     ${cte.sql}
     SELECT 1`,
    [homePage, username, ...cte.params]
  );
}

export async function dbAddValidatedHost(event: IPreemptEvent, username: string, host: string) {
  const cte = getLogEventCTE(event, 3);
  await pool.query(
    `WITH updated AS (
       UPDATE Users SET validated_hosts = array_append(validated_hosts, $1) WHERE username = $2 AND NOT ($1 = ANY(validated_hosts)) RETURNING username
     ),
     ${cte.sql}
     SELECT 1`,
    [host, username, ...cte.params]
  );
}

export async function dbGetUsers(event: IPreemptEvent) {
  const result = await pool.query(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page, validated_hosts FROM Users"
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
  addValidatedHost: dbAddValidatedHost,
  getAll: dbGetUsers
};
