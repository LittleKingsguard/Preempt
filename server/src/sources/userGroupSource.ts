import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import type { IUserGroupSource, IUserGroupData, IUserGroupMemberData } from "../models/interfaces.js";

export const pgUserGroupSource: IUserGroupSource = {
  async getAll(): Promise<IUserGroupData[]> {
    const result = await pool.query("SELECT * FROM UserGroups ORDER BY id ASC");
    return result.rows;
  },

  async getById(id: number): Promise<IUserGroupData | { error: string; status: number }> {
    const row = await queryFirstRow("SELECT * FROM UserGroups WHERE id = $1", [id], "UserGroup not found");
    return row;
  },

  async create(name: string): Promise<IUserGroupData | { error: string; status: number }> {
    try {
      const result = await pool.query(
        "INSERT INTO UserGroups (name) VALUES ($1) RETURNING *",
        [name]
      );
      return result.rows[0];
    } catch (err: any) {
      if (err.code === "23505") { // unique_violation
        return { error: "UserGroup with this name already exists", status: 409 };
      }
      throw err;
    }
  },

  async delete(id: number): Promise<any | { error: string; status: number }> {
    const result = await pool.query("DELETE FROM UserGroups WHERE id = $1 RETURNING id", [id]);
    if (result.rowCount === 0) {
      return { error: "UserGroup not found", status: 404 };
    }
    return { success: true };
  },

  async getMembers(groupId: number): Promise<IUserGroupMemberData[]> {
    const result = await pool.query("SELECT * FROM UserGroupMembers WHERE group_id = $1", [groupId]);
    return result.rows;
  },

  async addMember(groupId: number, username: string): Promise<void> {
    await pool.query(
      "INSERT INTO UserGroupMembers (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [groupId, username]
    );
  },

  async removeMember(groupId: number, username: string): Promise<void> {
    await pool.query("DELETE FROM UserGroupMembers WHERE group_id = $1 AND username = $2", [groupId, username]);
  },

  async getUserGroups(username: string): Promise<IUserGroupData[]> {
    const result = await pool.query(
      "SELECT ug.* FROM UserGroups ug JOIN UserGroupMembers ugm ON ug.id = ugm.group_id WHERE ugm.username = $1",
      [username]
    );
    return result.rows;
  }
};
