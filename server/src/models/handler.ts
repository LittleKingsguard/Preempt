import { pgHandlerSource } from "../sources/handlerSource.js";
import { pgSettingSource } from "../sources/settingsSource.js";
import { Setting } from "./settings.js";
import { validateUserRoles } from "../middleware/auth.js";
import type { IHandlerData, IHandlerSource } from "./interfaces.js";

export class Handler {
  source: IHandlerSource;
  id: number;
  name: string;
  body: string;
  author_id: string;
  is_approved: boolean;
  approved_roles: string[];
  created_at: Date;
  updated_at: Date;

  constructor(data: IHandlerData, source: IHandlerSource = pgHandlerSource) {
    this.source = source;
    this.id = data.id;
    this.name = data.name;
    this.body = data.body;
    this.author_id = data.author_id;
    this.is_approved = data.is_approved || false;
    this.approved_roles = data.approved_roles || [];
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
  }

  static async getAll(source: IHandlerSource = pgHandlerSource, user: any) {
    const rows = await source.getAll();
    return rows
      .filter(h => !validateUserRoles(user, h.approved_roles || [], h.author_id))
      .map(h => new Handler(h, source));
  }

  static async getById(source: IHandlerSource = pgHandlerSource, id: number) {
    const row = await source.getById(id);
    if ('error' in row) return row;
    return new Handler(row, source);
  }

  static async create(source: IHandlerSource = pgHandlerSource, user: any, data: any) {
    const hasTrustedDevs = await Setting.get(pgSettingSource, "hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to create handlers", status: 403 };
    }

    if (user.is_shadowed) {
      return { handler: new Handler({ id: 999999, name: data.name || "", body: data.body || "", author_id: user.username, is_approved: false }) };
    }

    const isApproved = Boolean(user.is_admin || (hasTrustedDevs && user.is_trusted_dev));

    const row = await source.create(data.name, data.body, user.username, isApproved);
    if (row && 'error' in row) return row;
    return { handler: new Handler(row, source) };
  }

  async update(user: any, data: any): Promise<{ error: string, status: number } | { handler: Handler }> {
    const hasTrustedDevs = await Setting.get(pgSettingSource, "hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to update handlers", status: 403 };
    }

    if (user.is_shadowed) {
      return { handler: new Handler({ id: this.id, name: data.name || "", body: data.body || "", is_approved: false, author_id: this.author_id }) };
    }

    try {
      const row = await this.source.update(this.id, data.name, data.body);
      if ('error' in row) return row;
      Object.assign(this, row);
      return { handler: this };
    } catch (err: any) {
      if (err.code === '23505') { // unique violation
        return { error: "Handler with this name already exists", status: 409 };
      }
      throw err;
    }
  }

  static async updateTemplateHandlers(source: IHandlerSource = pgHandlerSource, templateId: number, handlerNames: string[]) {
    await source.updateTemplateHandlers(templateId, handlerNames);
  }

  static async updateContentHandlers(source: IHandlerSource = pgHandlerSource, contentId: number, handlerNames: string[]) {
    await source.updateContentHandlers(contentId, handlerNames);
  }

  static async stage(source: IHandlerSource = pgHandlerSource, user: any, name: string, body: string, originalId: number | null, batchId: number) {
    const row = await source.stage(name, body, user.username, originalId, batchId);
    return { handler: new Handler(row, source) };
  }

  async delete(user: any) {
    const hasTrustedDevs = await Setting.get(pgSettingSource, "hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to delete handlers", status: 403 };
    }

    if (user.is_shadowed) return { success: true };

    try {
      const row = await this.source.delete(this.id);
      if ('error' in row) return row;
      return { handler: new Handler(row, this.source) };
    } catch (err: any) {
      throw err;
    }
  }

  async approve(user: any, is_approved: boolean): Promise<{ error: string, status: number } | { handler: Handler }> {
    const hasTrustedDevs = await Setting.get(pgSettingSource, "hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to approve/reject handlers", status: 403 };
    }

    try {
      const row = await this.source.approve(this.id, is_approved);
      if ('error' in row) return row;
      Object.assign(this, row);
      return { handler: this };
    } catch (err: any) {
      throw err;
    }
  }
}
