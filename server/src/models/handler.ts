import * as handlerSource from "../sources/handlerSource.js";
import { Setting } from "./settings.js";
import { validateUserRoles } from "../middleware/auth.js";

export class Handler {
  id: number;
  name: string;
  body: string;
  author_id: string;
  is_approved: boolean;
  approved_roles: string[];
  created_at: Date;
  updated_at: Date;

  constructor(data: any) {
    this.id = data.id;
    this.name = data.name;
    this.body = data.body;
    this.author_id = data.author_id;
    this.is_approved = data.is_approved;
    this.approved_roles = data.approved_roles || [];
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async getAll(user: any) {
    const rows = await handlerSource.dbGetHandlers();
    return rows
      .filter(h => !validateUserRoles(user, h.approved_roles || [], h.author_id))
      .map(h => new Handler(h));
  }

  static async getById(id: number) {
    const row = await handlerSource.dbGetHandlerById(id);
    if ('error' in row) return row;
    return new Handler(row);
  }

  static async create(user: any, data: any) {
    const hasTrustedDevs = await Setting.get("hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to create handlers", status: 403 };
    }

    if (user.is_shadowed) {
      return { handler: new Handler({ id: 999999, name: data.name || "", body: data.body || "", author_id: user.username, is_approved: false }) };
    }

    const isApproved = Boolean(user.is_admin || (hasTrustedDevs && user.is_trusted_dev));

    try {
      const row = await handlerSource.dbCreateHandler(data.name, data.body, user.username, isApproved);
      return { handler: new Handler(row) };
    } catch (err: any) {
      if (err.code === '23505') { // unique violation
        return { error: "Handler with this name already exists", status: 409 };
      }
      throw err;
    }
  }

  async update(user: any, data: any): Promise<{ error: string, status: number } | { handler: Handler }> {
    const hasTrustedDevs = await Setting.get("hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to update handlers", status: 403 };
    }

    if (user.is_shadowed) {
      return { handler: new Handler({ id: this.id, name: data.name || "", body: data.body || "", is_approved: false }) };
    }

    try {
      const row = await handlerSource.dbUpdateHandler(this.id, data.name, data.body);
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

  static async updateTemplateHandlers(client: any, templateId: number, handlerNames: string[]) {
    await handlerSource.dbUpdateTemplateHandlers(client, templateId, handlerNames);
  }

  static async updateContentHandlers(client: any, contentId: number, handlerNames: string[]) {
    await handlerSource.dbUpdateContentHandlers(client, contentId, handlerNames);
  }

  static async stage(user: any, name: string, body: string, originalId: number | null, batchId: number) {
    const row = await handlerSource.dbStageHandler(name, body, user.username, originalId, batchId);
    return { handler: new Handler(row) };
  }

  async delete(user: any) {
    const hasTrustedDevs = await Setting.get("hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || user.is_contributor || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to delete handlers", status: 403 };
    }

    if (user.is_shadowed) return { success: true };

    try {
      const row = await handlerSource.dbDeleteHandler(this.id);
      if ('error' in row) return row;
      return { handler: new Handler(row) };
    } catch (err: any) {
      throw err;
    }
  }

  async approve(user: any, is_approved: boolean): Promise<{ error: string, status: number } | { handler: Handler }> {
    const hasTrustedDevs = await Setting.get("hasTrustedDevs");
    const isAuthorized = user && (user.is_admin || (hasTrustedDevs && user.is_trusted_dev));
    if (!isAuthorized) {
      return { error: "Forbidden: Not authorized to approve/reject handlers", status: 403 };
    }

    try {
      const row = await handlerSource.dbApproveHandler(this.id, is_approved);
      if ('error' in row) return row;
      Object.assign(this, row);
      return { handler: this };
    } catch (err: any) {
      throw err;
    }
  }
}
