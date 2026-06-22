import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import type { IUserGroupSource, IUserGroupData, IUserGroupMemberData } from "../models/interfaces.js";

export const pgUserGroupSource: IUserGroupSource = {
  async getAll(event: IPreemptEvent): Promise<IUserGroupData[]> {
    const result = await pool.query("SELECT * FROM UserGroups ORDER BY id ASC");
    fireAndForgetEvent(event);
    return result.rows;
  },

  async getById(event: IPreemptEvent, id: number): Promise<IUserGroupData | { error: string; status: number }> {
    const row = await queryFirstRow("SELECT * FROM UserGroups WHERE id = $1", [id], "UserGroup not found");
    fireAndForgetEvent(event);
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
