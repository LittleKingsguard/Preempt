import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, logEvent, fireAndForgetEvent } from "../utils/db.js";
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        "INSERT INTO UserGroups (name) VALUES ($1) RETURNING *",
        [name]
      );
      await logEvent(client, event);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === "23505") { // unique_violation
        return { error: "UserGroup with this name already exists", status: 409 };
      }
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("DELETE FROM UserGroups WHERE id = $1 RETURNING id", [id]);
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return { error: "UserGroup not found", status: 404 };
      }
      await logEvent(client, event);
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getMembers(event: IPreemptEvent, groupId: number): Promise<IUserGroupMemberData[]> {
    const result = await pool.query("SELECT * FROM UserGroupMembers WHERE group_id = $1", [groupId]);
    fireAndForgetEvent(event);
    return result.rows;
  },

  async addMember(event: IPreemptEvent, groupId: number, username: string | string[]): Promise<void> {
    const usernames = Array.isArray(username) ? username : [username];
    if (usernames.length === 0) return;

    const values = [];
    const params: any[] = [];
    for (let i = 0; i < usernames.length; i++) {
      values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
      params.push(groupId, usernames[i]);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO UserGroupMembers (group_id, username) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
        params
      );
      await logEvent(client, event);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async removeMember(event: IPreemptEvent, groupId: number, username: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM UserGroupMembers WHERE group_id = $1 AND username = $2", [groupId, username]);
      await logEvent(client, event);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
