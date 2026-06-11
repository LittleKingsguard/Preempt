import type { IUserGroupSource, IUserGroupData } from "./interfaces.js";
import { pgUserGroupSource } from "../sources/userGroupSource.js";

export class UserGroup {
  id: number;
  name: string;

  constructor(data: IUserGroupData) {
    this.id = data.id;
    this.name = data.name;
  }

  static async getAll(source: IUserGroupSource = pgUserGroupSource) {
    const data = await source.getAll();
    return data.map(d => new UserGroup(d));
  }

  static async getById(id: number, source: IUserGroupSource = pgUserGroupSource) {
    const data = await source.getById(id);
    if ('error' in data) return data;
    return new UserGroup(data);
  }

  static async create(user: any, name: string, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can create groups", status: 403 };
    }
    const data = await source.create(name);
    if ('error' in data) return data;
    return new UserGroup(data);
  }

  async delete(user: any, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can delete groups", status: 403 };
    }
    return await source.delete(this.id);
  }

  async getMembers(source: IUserGroupSource = pgUserGroupSource) {
    return await source.getMembers(this.id);
  }

  async addMember(user: any, username: string, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can manage group members", status: 403 };
    }
    await source.addMember(this.id, username);
    return { success: true };
  }

  async removeMember(user: any, username: string, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can manage group members", status: 403 };
    }
    await source.removeMember(this.id, username);
    return { success: true };
  }
}
