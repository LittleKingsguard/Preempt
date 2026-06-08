import * as componentSource from "../sources/componentSource.js";
import { validateUserRoles } from "../middleware/auth.js";

export class Component {
  id: number;
  name: string;
  payload: any;
  author_id: string;
  approved_roles: string[];
  created_at: Date;
  updated_at: Date;

  constructor(data: any) {
    this.id = data.id;
    this.name = data.name;
    this.payload = data.payload;
    this.author_id = data.author_id;
    this.approved_roles = data.approved_roles || [];
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async getAll(user: any) {
    const rows = await componentSource.dbGetComponents();
    return rows
      .filter(c => !validateUserRoles(user, c.approved_roles || [], c.author_id))
      .map(c => new Component(c));
  }

  static async getById(id: number) {
    const row = await componentSource.dbGetComponentById(id);
    if ('error' in row) return row;
    return new Component(row);
  }

  static async create(user: any, data: any) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can create components", status: 403 };
    }

    if (user.is_shadowed) {
      return { component: new Component({ id: 999999, name: data.name || "", payload: data.payload || {}, author_id: user.username }) };
    }

    if (!data.name || !data.payload) {
      return { error: "Name and payload are required", status: 400 };
    }

    try {
      const row = await componentSource.dbCreateComponent(data.name, data.payload, user.username);
      return { component: new Component(row) };
    } catch (err: any) {
      if (err.code === '23505') {
        return { error: "Component with this name already exists", status: 409 };
      }
      throw err;
    }
  }

  async update(user: any, data: any): Promise<{ error: string, status: number } | { component: Component }> {
    if (!user || !user.is_admin) {
      const authErr = validateUserRoles(user, ["admin", "author"], this.author_id);
      if (authErr) return { error: authErr.error, status: authErr.status };
    }

    if (user.is_shadowed) {
      return { component: new Component({ id: this.id, name: data.name || "", payload: data.payload || {} }) };
    }

    if (!data.name || !data.payload) {
      return { error: "Name and payload are required", status: 400 };
    }

    try {
      const row = await componentSource.dbUpdateComponent(this.id, data.name, data.payload);
      if ('error' in row) return row;
      Object.assign(this, row);
      return { component: this };
    } catch (err: any) {
      if (err.code === '23505') {
        return { error: "Component with this name already exists", status: 409 };
      }
      throw err;
    }
  }

  async delete(user: any) {
    const authErr = validateUserRoles(user, ["admin", "author"], this.author_id);
    if (authErr) return { error: authErr.error, status: authErr.status };

    if (user.is_shadowed) return { success: true };

    const row = await componentSource.dbDeleteComponent(this.id);
    if ('error' in row) return row;
    return { success: true };
  }

  static async updateTemplateComponents(client: any, templateId: number, componentNames: string[]) {
    await componentSource.dbUpdateTemplateComponents(client, templateId, componentNames);
  }

  static async updateContentComponents(client: any, contentId: number, componentNames: string[]) {
    await componentSource.dbUpdateContentComponents(client, contentId, componentNames);
  }

  static async stage(user: any, name: string, payload: any, originalId: number | null, batchId: number) {
    const row = await componentSource.dbStageComponent(name, payload, user.username, originalId, batchId);
    return { component: new Component(row) };
  }
}
