import { PreemptEvent } from "../../../src/types/Event.js";
import type { IUserGroupSource, IUserGroupData } from "./interfaces.js";
import { pgUserGroupSource } from "../sources/userGroupSource.js";

export class UserGroup {
  id: number;
  name: string;

  constructor(data: IUserGroupData) {
    this.id = data.id;
    this.name = data.name;
  }

  static async getAll(source: IUserGroupSource = pgUserGroupSource, criteria?: { format?: 'raw' | 'content' }) {
    const data = await source.getAll(new PreemptEvent<any>('userGroup.getAll', { id: 'system', type: 'process' }), criteria);
    if (criteria?.format === 'content') return data;
    return data.map((d: any) => new UserGroup(d));
  }

  static async getById(id: number, source: IUserGroupSource = pgUserGroupSource, criteria?: { format?: 'raw' | 'content' }) {
    const data = await source.getById(new PreemptEvent<any>('userGroup.getById', { id: 'system', type: 'process' }, [], { before: null, after: { id } }), id, criteria);
    if ('error' in data) return data;
    if (criteria?.format === 'content') return data;
    return new UserGroup(data);
  }

  static async create(user: any, name: string, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can create groups", status: 403 };
    }
    const data = await source.create(new PreemptEvent<any>('userGroup.create', { id: 'system', type: 'process' }, [], { before: null, after: { name } }), name);
    if ('error' in data) return data;
    return new UserGroup(data);
  }

  async delete(user: any, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can delete groups", status: 403 };
    }
    return await source.delete(new PreemptEvent<any>('userGroup.delete', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { id: this.id } }), this.id);
  }

  async getMembers(source: IUserGroupSource = pgUserGroupSource) {
    return await source.getMembers(new PreemptEvent<any>('userGroup.getMembers', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { id: this.id } }), this.id);
  }

  async addMember(user: any, username: string | string[], source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can manage group members", status: 403 };
    }
    await source.addMember(new PreemptEvent<any>('userGroup.addMember', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username } }), this.id, username);
    return { success: true };
  }

  async removeMember(user: any, username: string, source: IUserGroupSource = pgUserGroupSource) {
    if (!user || !user.is_admin) {
      return { error: "Forbidden: Only admins can manage group members", status: 403 };
    }
    await source.removeMember(new PreemptEvent<any>('userGroup.removeMember', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username } }), this.id, username);
    return { success: true };
  }
}
