import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import type { IUserGroupSource, IUserGroupData, IUserGroupMemberData, IContentData } from "../models/interfaces.js";
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultUsergroup: any = null;
let cachedDefaultUsergroupTimestamp: number = 0;
const CACHE_TTL_MS = 60000;

async function getDefaultUsergroupComponent(event: IPreemptEvent) {
  const now = Date.now();
  if (!cachedDefaultUsergroup || now - cachedDefaultUsergroupTimestamp > CACHE_TTL_MS) {
    const row = await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", ['default-usergroup']);
    cachedDefaultUsergroup = row ? JSON.parse(row.value) : null;
    cachedDefaultUsergroupTimestamp = now;
    
    if (!cachedDefaultUsergroup) {
      cachedDefaultUsergroup = {
        type: 'div',
        css: { classes: ['usergroup-item'] },
        content: [
          { type: 'strong', component: [{ reference: 'groupName', target: 'content' }] },
          { type: 'span', content: ' (ID: ' },
          { type: 'span', component: [{ reference: 'groupId', target: 'content' }] },
          { type: 'span', content: ')' }
        ]
      };
    }
  }
  return cachedDefaultUsergroup;
}

function compileUserGroupsToContent(groupRows: any[], defaultGroupComp: any): IContentData {
  const payload = groupRows.map(row => {
    return {
      ...defaultGroupComp,
      placement: [{ targetPlacement: [`usergroup-${row.id}`, "usergroups"] }],
      component: [
        { reference: 'groupName', value: row.name },
        { reference: 'groupId', value: row.id.toString() }
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

export const pgUserGroupSource: IUserGroupSource = {
  async getAll(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }): Promise<any> {
    const result = await pool.query("SELECT * FROM UserGroups ORDER BY id ASC");
    fireAndForgetEvent(event);
    
    if (criteria?.format === 'content') {
      const defaultComp = await getDefaultUsergroupComponent(event);
      return compileUserGroupsToContent(result.rows, defaultComp);
    }
    
    return result.rows;
  },

  async getById(event: IPreemptEvent, id: number, criteria?: { format?: 'raw' | 'content' }): Promise<any | { error: string; status: number }> {
    const row = await queryFirstRow("SELECT * FROM UserGroups WHERE id = $1", [id], "UserGroup not found");
    fireAndForgetEvent(event);
    
    if (row && !('error' in row) && criteria?.format === 'content') {
      const defaultComp = await getDefaultUsergroupComponent(event);
      return compileUserGroupsToContent([row], defaultComp);
    }
    
    return row;
  },

  async create(event: IPreemptEvent, name: string): Promise<IUserGroupData | { error: string; status: number }> {
    const cte = getLogEventCTE(event, 2);
    try {
      const result = await pool.query(
        `WITH inserted AS (
           INSERT INTO UserGroups (name) VALUES ($1) RETURNING *
         ),
         ${cte.sql}
         SELECT * FROM inserted`,
        [name, ...cte.params]
      );
      return result.rows[0];
    } catch (err: any) {
      if (err.code === "23505") { // unique_violation
        return { error: "UserGroup with this name already exists", status: 409 };
      }
      throw err;
    }
  },

  async delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }> {
    const cte = getLogEventCTE(event, 2);
    const result = await pool.query(
      `WITH deleted AS (
         DELETE FROM UserGroups WHERE id = $1 RETURNING id
       ),
       ${cte.sql}
       SELECT * FROM deleted`,
      [id, ...cte.params]
    );
    if (result.rowCount === 0) {
      return { error: "UserGroup not found", status: 404 };
    }
    return { success: true };
  },

  async getMembers(event: IPreemptEvent, groupId: number): Promise<IUserGroupMemberData[]> {
    const result = await pool.query("SELECT * FROM UserGroupMembers WHERE group_id = $1", [groupId]);
    fireAndForgetEvent(event);
    return result.rows;
  },

  async addMember(event: IPreemptEvent, groupId: number, username: string | string[]): Promise<void> {
    const usernames = Array.isArray(username) ? username : [username];
    if (usernames.length === 0) return;
    const cte = getLogEventCTE(event, 3);
    await pool.query(`
      WITH inserted AS (
        INSERT INTO UserGroupMembers (group_id, username) 
        SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING
      ),
      ${cte.sql}
      SELECT 1
    `, [groupId, usernames, ...cte.params]);
  },

  async removeMember(event: IPreemptEvent, groupId: number, username: string): Promise<void> {
    const cte = getLogEventCTE(event, 3);
    await pool.query(
      `WITH deleted AS (
         DELETE FROM UserGroupMembers WHERE group_id = $1 AND username = $2
       ),
       ${cte.sql}
       SELECT 1`,
      [groupId, username, ...cte.params]
    );
  },

  async getUserGroups(event: IPreemptEvent, username: string): Promise<IUserGroupData[]> {
    const result = await pool.query(
      "SELECT ug.* FROM UserGroups ug JOIN UserGroupMembers ugm ON ug.id = ugm.group_id WHERE ugm.username = $1",
      [username]
    );
    fireAndForgetEvent(event);
    return result.rows;
  }
};
