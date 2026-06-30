import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import type { IUserSource, IContentData } from "../models/interfaces.js";
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultUser: any = null;
let cachedDefaultUserTimestamp: number = 0;
const CACHE_TTL_MS = 60000;

async function getDefaultUserComponent(event: IPreemptEvent) {
  const now = Date.now();
  if (!cachedDefaultUser || now - cachedDefaultUserTimestamp > CACHE_TTL_MS) {
    const row = await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", ['default-user']);
    cachedDefaultUser = row ? JSON.parse(row.value) : null;
    cachedDefaultUserTimestamp = now;
    
    if (!cachedDefaultUser) {
      cachedDefaultUser = {
        type: 'div',
        css: { classes: ['user-item'] },
        content: [
          { type: 'strong', component: [{ reference: 'userUsername', target: 'content' }] },
          { type: 'span', content: ' (' },
          { type: 'span', component: [{ reference: 'userEmail', target: 'content' }] },
          { type: 'span', content: ')' }
        ]
      };
    }
  }
  return cachedDefaultUser;
}

function compileUsersToContent(userRows: any[], defaultUserComp: any): IContentData {
  const payload = userRows.map(row => {
    return {
      ...defaultUserComp,
      placement: { targetPlacement: [`user-${row.username}`, "users"] },
      component: [
        { reference: 'userUsername', value: row.username },
        { reference: 'userEmail', value: row.email }
      ]
    };
  });

  return {
    id: 0,
    author_id: 'system',
    payload: payload,
    headers: null,
    is_visible: true,
    live_date: new Date(),
    resolved_template_id: 0,
    created_at: new Date(),
    updated_at: new Date()
  };
}

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
  const row = await queryFirstRow("SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page, validated_hosts FROM Users WHERE email = $1", [email], "User not found");
  fireAndForgetEvent(event);
  return row;
}

export async function dbGetUserByUsername(event: IPreemptEvent, username: string, criteria?: { format?: 'raw' | 'content' }) {
  const row = await queryFirstRow("SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_2fa_enabled, is_shadowed, has_verified, is_bot, home_page, validated_hosts FROM Users WHERE username = $1", [username], "User not found");
  fireAndForgetEvent(event);
  
  if (row && !('error' in row) && criteria?.format === 'content') {
    const defaultComp = await getDefaultUserComponent(event);
    return compileUsersToContent([row], defaultComp);
  }
  
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

export async function dbUpdateUserRoles(event: IPreemptEvent, username: string, roles: { is_admin?: boolean, is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
  const updates: string[] = [];
  const values: any[] = [];
  let index = 1;
  
  if (roles.is_admin !== undefined) {
    updates.push(`is_admin = $${index++}`);
    values.push(roles.is_admin);
  }
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

export async function dbGetUsers(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }) {
  const result = await pool.query(
    "SELECT username, email, is_admin, is_contributor, is_trusted_dev, is_shadowed, has_verified, is_bot, home_page, validated_hosts FROM Users"
  );
  fireAndForgetEvent(event);
  
  if (criteria?.format === 'content') {
    const defaultComp = await getDefaultUserComponent(event);
    return compileUsersToContent(result.rows, defaultComp);
  }
  
  return result.rows;
}

export async function dbHasAdmin(event: IPreemptEvent): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM Users WHERE is_admin = true AND is_bot = false LIMIT 1");
  fireAndForgetEvent(event);
  return result.rowCount !== null && result.rowCount > 0;
}

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
  getAll: dbGetUsers,
  hasAdmin: dbHasAdmin
};
