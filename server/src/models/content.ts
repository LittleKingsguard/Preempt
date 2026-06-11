import { pool } from "../db.js";
import { buildContentQuery, applyEditorTemplateOverride, checkContentSecurity, populateContentHandlers, populateContentComponents } from "../utils/contentUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "../utils/editorUtils.js";
import { Tag } from "./tag.js";
import { validateUserRoles } from "../middleware/auth.js";
import { pgContentSource } from "../sources/contentSource.js";
import { pgTagSource } from "../sources/tagSource.js";
import { pgSettingSource } from "../sources/settingsSource.js";
import { Setting } from "./settings.js";
import type { IContentData, IContentSource, IContentUserData, IContentUserGroupData } from "./interfaces.js";

export class Content {
  static guardPlaceholderCache: any = null;
  source: IContentSource;
  id: number;
  author_id: string;
  payload: any;
  template_payload: any;
  promo?: any;
  headers: string | null;
  is_visible: boolean;
  live_date: Date | null;
  approved_roles: string[];
  resolved_template_id: number;
  created_at: Date;
  updated_at: Date;
  users?: IContentUserData[];
  groups?: IContentUserGroupData[];

  constructor(data: IContentData, source: IContentSource = pgContentSource) {
    this.source = source;
    this.id = data.id;
    this.author_id = data.author_id;
    this.payload = data.payload;
    this.template_payload = data.template_payload;
    this.promo = data.promo;
    this.headers = data.headers || null;
    this.is_visible = data.is_visible || false;
    this.live_date = data.live_date || null;
    this.approved_roles = data.approved_roles || [];
    this.resolved_template_id = data.resolved_template_id;
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
    this.users = data.users || [];
    this.groups = data.groups || [];
  }

  static async getById(source: IContentSource = pgContentSource, id: number, user?: any) {
    const row = await source.getById(id, user);
    if ('error' in row) return row;
    return new Content(row, source);
  }

  static async getHeaders(source: IContentSource = pgContentSource, id: number) {
    return await source.getHeaders(id);
  }

  static async getWithTemplate(source: IContentSource = pgContentSource, contentId: number, templateId: number | null, tagsParam: string | null, editorMode: string | null = null, user: any = null) {
    const { query, params } = buildContentQuery(contentId, templateId, tagsParam, editorMode);
    const row = await source.query(query, params);
    if ('error' in row) return row;

    const content = new Content(row, source);

    if (editorMode) {
      await applyEditorTemplateOverride(row);
      content.template_payload = row.template_payload;
    } else if (!(await checkContentSecurity(content.resolved_template_id, editorMode))) {
      return { error: "Security check failed", status: 403 };
    }

    const isAdmin = user?.is_admin === true;
    const userRole = content.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = content.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    const hasViewAccess = isAdmin || userRole || groupRole;

    const now = new Date();
    const isPublic = content.is_visible && (!content.live_date || new Date(content.live_date) <= now);

    if (!isPublic && !hasViewAccess) {
      const behavior = await Setting.get(pgSettingSource, "contentReturnBehavior") || "Overlook";
      if (behavior === "Guard") {
        if (!Content.guardPlaceholderCache) {
          Content.guardPlaceholderCache = await Setting.get(pgSettingSource, "guardPlaceholder");
        }
        const placeholder = Content.guardPlaceholderCache;
        content.payload = placeholder || { type: "div", content: "Content restricted" };
        return { content };
      } else if (behavior === "Paywall") {
        content.payload = content.promo || { message: "Paywall Promo Material" }; // Mocked paywall
        return { content };
      } else {
        return { error: "Forbidden: Content is not visible", status: 403 };
      }
    }

    const authErr = validateUserRoles(user, content.approved_roles || [], content.author_id);
    if (authErr) return authErr;

    await populateContentHandlers(content.payload, content.id, content.resolved_template_id, user);
    await populateContentComponents(content.payload, content.id, content.resolved_template_id, user);

    if (editorMode) {
      const hasEditorTag = await checkHasEditorTag(content.resolved_template_id);
      await injectEditorDependencies(content.payload, content.template_payload, editorMode, hasEditorTag);
    }

    return { content };
  }

  static async getLatest(source: IContentSource = pgContentSource, criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}, user?: any) {
    const behavior = await Setting.get(undefined, "contentReturnBehavior") || "Overlook";
    
    let rows;
    if (behavior === "Guard") {
      if (!Content.guardPlaceholderCache) {
         Content.guardPlaceholderCache = await Setting.get(undefined, "guardPlaceholder");
      }
      rows = await source.getLatestGuard(criteria, user, Content.guardPlaceholderCache);
    } else if (behavior === "Paywall") {
      rows = await source.getLatestPaywall(criteria, user);
    } else {
      rows = await source.getLatestOverlook(criteria, user);
    }

    const contents = rows.map(r => new Content(r, source));
    return contents;
  }
  static async getCount(source: IContentSource = pgContentSource, criteria: { tags?: string[]; author?: string } = {}, user?: any) {
    const behavior = await Setting.get(undefined, "contentReturnBehavior") || "Overlook";
    
    if (behavior === "Guard") {
      return await source.getCountGuard(criteria, user);
    } else if (behavior === "Paywall") {
      return await source.getCountPaywall(criteria, user);
    } else {
      return await source.getCountOverlook(criteria, user);
    }
  }


  static async stage(source: IContentSource = pgContentSource, user: any, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[] = [], groupIds: number[] = [], promo?: any) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let isStagedRow = false;
      if (originalId) {
        isStagedRow = await source.getForStaging(client, originalId);
      }

      let row;
      if (isStagedRow) {
        row = await source.updateStaged(client, user.username, payload, headers, originalId!, batchId, promo);
      } else {
        row = await source.insertStaged(client, user.username, payload, headers, originalId, batchId, promo);
      }
      
      const content = new Content(row, source);

      if (tags && Array.isArray(tags)) {
        if (isStagedRow || tags.length > 0) {
          await Tag.updateContentTags(pgTagSource, client, content.id, tags);
        }
      }
      if (groupIds && Array.isArray(groupIds)) {
        if (isStagedRow || groupIds.length > 0) {
          await source.updateTemplateGroups(client, content.id, groupIds);
        }
      }
      
      await client.query('COMMIT');
      return { content };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async create(source: IContentSource = pgContentSource, user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null, promo?: any) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can create content directly", status: 403 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await source.create(client, user.username, payload, headers, isVisible, liveDate ? new Date(liveDate) : new Date(), promo);
      const content = new Content(row, source);
      
      await source.addUser(client, content.id, user.username, 'Owner');
      content.users = [{ content_id: content.id, username: user.username, role: 'Owner' }];

      if (tags && tags.length > 0) {
        await Tag.updateContentTags(pgTagSource, client, content.id, tags);
      }
      if (groupIds) {
        await source.updateTemplateGroups(client, content.id, groupIds);
      }
      
      await client.query('COMMIT');
      return { content };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null, promo?: any): Promise<{ error: string, status: number } | { content: Content }> {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    const canUpdate = isAdmin || userRole === 'Owner' || userRole === 'Contributor' || groupRole === 'Owner' || groupRole === 'Contributor';

    if (!canUpdate) {
      return { error: "Forbidden: You do not have permission to update this content", status: 403 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const row = await this.source.update(client, this.id, user.username, payload, headers, isVisible, liveDate ? new Date(liveDate) : new Date(), promo);
      if ('error' in row) {
        await client.query('ROLLBACK');
        return row;
      }
      Object.assign(this, row);
      
      await Tag.updateContentTags(pgTagSource, client, this.id, tags || []);
      await this.source.updateTemplateGroups(client, this.id, groupIds || []);
      
      await client.query('COMMIT');
      return { content: this };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async delete(user: any) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    const canDelete = isAdmin || userRole === 'Owner' || groupRole === 'Owner';

    if (!canDelete) {
      return { error: "Forbidden: You do not have permission to delete this content", status: 403 };
    }
    
    try {
      const row = await this.source.delete(this.id);
      if ('error' in row) return row;
      return { success: true };
    } catch (err: any) {
      throw err;
    }
  }

  async addRole(user: any, targetUsername: string, role: string) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    const client = await pool.connect();
    try {
      const result = await this.source.addUser(client, this.id, targetUsername, role);
      return { success: true, role: result };
    } catch (e) {
      throw e;
    } finally {
      client.release();
    }
  }

  async removeRole(user: any, targetUsername: string) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    const client = await pool.connect();
    try {
      await this.source.removeUser(client, this.id, targetUsername);
      return { success: true };
    } catch (e) {
      throw e;
    } finally {
      client.release();
    }
  }

  async addGroupRole(user: any, targetGroupId: number, role: string) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    const client = await pool.connect();
    try {
      const result = await this.source.addGroup(client, this.id, targetGroupId, role);
      return { success: true, role: result };
    } catch (e) {
      throw e;
    } finally {
      client.release();
    }
  }

  async removeGroupRole(user: any, targetGroupId: number) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    const client = await pool.connect();
    try {
      await this.source.removeGroup(client, this.id, targetGroupId);
      return { success: true };
    } catch (e) {
      throw e;
    } finally {
      client.release();
    }
  }
}
