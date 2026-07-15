import { PreemptEvent } from "../../../src/types/Event.js";
import { checkContentSecurity, populateContentHandlers, populateContentComponents } from "../utils/contentUtils.js";
import { Tag } from "./tag.js";
import { validateUserRoles } from "../middleware/auth.js";
import { pgContentSource } from "../sources/contentSource.js";
import { pgTemplateSource } from "../sources/templateSource.js";
import { pgTagSource } from "../sources/tagSource.js";
import { pgSettingSource } from "../sources/settingsSource.js";
import { pgHandlerSource } from "../sources/handlerSource.js";
import { pgComponentSource } from "../sources/componentSource.js";
import { Setting } from "./settings.js";
import type { IContentData, IContentSource, IContentUserData, IContentUserGroupData, IHandlerSource, IComponentSource } from "./interfaces.js";

export class Content {
  static guardPlaceholderCache: any = null;
  static defaultEditorCache: any = null;
  source: IContentSource;
  id: number;
  author_id: string;
  payload: any;
  template_payload: any;
  promo?: any;
  metadata?: any;
  headers: string | null;
  is_visible: boolean;
  live_date: Date | null;
  approved_roles: string[];
  resolved_template_id: number;
  change_batch_id?: number | null;
  tags?: string[];
  template_group_id?: number | null;
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
    this.metadata = data.metadata;
    this.headers = data.headers || null;
    this.is_visible = data.is_visible || false;
    this.live_date = data.live_date || null;
    this.approved_roles = data.approved_roles || [];
    this.resolved_template_id = data.resolved_template_id;
    this.change_batch_id = data.change_batch_id || null;
    this.tags = data.tags || [];
    this.template_group_id = data.template_group_id || null;
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
    this.users = data.users || [];
    this.groups = data.groups || [];
  }

  hasViewAccess(user: any): boolean {
    if (user?.is_admin === true) return true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    if (userRole) return true; // Any role (Owner, Contributor, Commenter, Viewer) gives view access
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (groupRole) return true;
    return false;
  }

  hasCommentAccess(user: any): boolean {
    if (user?.is_admin === true) return true;
    const allowedRoles = ['Owner', 'Contributor', 'Commenter'];
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    if (userRole && allowedRoles.includes(userRole)) return true;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (groupRole && allowedRoles.includes(groupRole)) return true;
    return false;
  }

  static async getById(source: IContentSource = pgContentSource, id: number, user?: any) {
    const row = await source.get(new PreemptEvent<any>('content.get', { id: 'system', type: 'process' }, [], { before: null, after: { id } }), { id }, user);
    if (!row || 'error' in row) return row || { error: "Content not found", status: 404 };
    return new Content(row, source);
  }

  static async getHeaders(source: IContentSource = pgContentSource, id: number) {
    return await source.getHeaders(new PreemptEvent<any>('content.getHeaders', { id: 'system', type: 'process' }, [], { before: null, after: { id } }), id);
  }

  static async getWithTemplate(
    source: IContentSource = pgContentSource,
    templateSource: IContentSource = pgTemplateSource,
    contentId: number,
    templateId: number | null,
    tagsParam: string | null,
    editorMode: string | null = null,
    user: any = null,
    handlerSource: IHandlerSource = pgHandlerSource,
    componentSource: IComponentSource = pgComponentSource
  ) {
    const contentRow = await source.get(new PreemptEvent<any>('content.get', { id: 'system', type: 'process' }, [], { before: null, after: { templateSource, contentId, templateId, tagsParam, editorMode, handlerSource, componentSource } }), { id: contentId }, user);
    if (!contentRow || 'error' in contentRow) return contentRow || { error: "Content not found", status: 404 };

    const content = new Content(contentRow, source);

    let templateRow;
    if (templateId) {
      templateRow = await templateSource.get(new PreemptEvent<any>('content.get', { id: 'system', type: 'process' }, [], { before: null, after: { templateSource, contentId, templateId, tagsParam, editorMode, handlerSource, componentSource } }), { id: templateId }, user);
    } else {
      const tagsArray = editorMode
        ? ["editor"]
        : (tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(t => t) : []);

      const templates = await templateSource.get(new PreemptEvent<any>('content.get', { id: 'system', type: 'process' }, [], { before: null, after: { templateSource, contentId, templateId, tagsParam, editorMode, handlerSource, componentSource } }), { list_id: contentRow.template_group_id, tags: tagsArray }, user);
      templateRow = templates && templates.length > 0 ? templates[0] : null;
    }

    if (!templateRow || 'error' in templateRow) {
      return { error: "Template not found", status: 404 };
    }

    content.template_payload = templateRow.payload;
    content.resolved_template_id = templateRow.id;

    if (!editorMode && !(await checkContentSecurity(content.resolved_template_id, editorMode))) {
      return { error: "Security check failed", status: 403 };
    }

    const hasViewAccess = content.hasViewAccess(user);

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

    await populateContentHandlers(content.payload, content.id, content.resolved_template_id, user, handlerSource, componentSource);
    await populateContentComponents(content.payload, content.id, content.resolved_template_id, user, componentSource);





    return { content };
  }

  static async getLatest(source: IContentSource = pgContentSource, criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}, user?: any) {
    const behavior = await Setting.get(undefined, "contentReturnBehavior") || "Overlook";

    let placeholder;
    if (behavior === "Guard") {
      if (!Content.guardPlaceholderCache) {
        Content.guardPlaceholderCache = await Setting.get(undefined, "guardPlaceholder");
      }
      placeholder = Content.guardPlaceholderCache;
    }

    const rows = await source.get(new PreemptEvent<any>('content.get', { id: 'system', type: 'process' }, [], { before: null, after: { criteria } }), { ...criteria, hide_pattern: behavior as 'Overlook' | 'Paywall' | 'Guard' }, user, placeholder);
    const contents = [];
    for (const r of rows) {
      const c = new Content(r, source);
      await populateContentHandlers(c.payload, c.id, c.resolved_template_id, user, pgHandlerSource, pgComponentSource);
      await populateContentComponents(c.payload, c.id, c.resolved_template_id, user, pgComponentSource);
      contents.push(c);
    }
    return contents;
  }
  static async getCount(source: IContentSource = pgContentSource, criteria: { tags?: string[]; author?: string } = {}, user?: any) {
    const behavior = await Setting.get(undefined, "contentReturnBehavior") || "Overlook";

    return await source.get(new PreemptEvent<any>('content.get', { id: 'system', type: 'process' }, [], { before: null, after: { criteria } }), { ...criteria, count_only: true, hide_pattern: behavior as 'Overlook' | 'Paywall' | 'Guard' }, user);
  }


  static async stage(source: IContentSource = pgContentSource, user: any, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[] = [], groupIds: number[] = [], promo?: any) {
    const row = await source.stage(new PreemptEvent<any>('content.stage', { id: 'system', type: 'process' }, [], { before: null, after: { payload, headers, originalId, batchId, tags, groupIds, promo } }), user.username, payload, headers, originalId, batchId, tags, groupIds, promo);
    if ('error' in row) return row;
    const content = new Content(row, source);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    return { content };
  }

  static async create(source: IContentSource = pgContentSource, user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null, promo?: any) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can create content directly", status: 403 };
    }

    const row = await source.create(new PreemptEvent<any>('content.create', { id: 'system', type: 'process' }, [], { before: null, after: { payload, headers, tags, groupIds, isVisible, liveDate, promo } }), user.username, payload, headers, isVisible, liveDate ? new Date(liveDate) : new Date(), tags, groupIds, promo);
    if ('error' in row) return row;
    const content = new Content(row, source);
    content.users = [{ content_id: content.id, username: user.username, role: 'Owner' }];

    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }

    return { content };
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

    const row = await this.source.update(new PreemptEvent<any>('content.update', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { payload, headers, tags, groupIds, isVisible, liveDate, promo } }), this.id, user.username, payload, headers, isVisible, liveDate ? new Date(liveDate) : new Date(), tags, groupIds, promo);
    if ('error' in row) return row;
    Object.assign(this, row);

    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }

    return { content: this };
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
      const row = await this.source.delete(new PreemptEvent<any>('content.delete', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { id: this.id } }), this.id);
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
    const result = await this.source.addUser(new PreemptEvent<any>('content.addUser', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { targetUsername, role } }), this.id, targetUsername, role);
    return { success: true, role: result };
  }

  async removeRole(user: any, targetUsername: string) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    await this.source.removeUser(new PreemptEvent<any>('content.removeUser', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { targetUsername } }), this.id, targetUsername);
    return { success: true };
  }

  async addGroupRole(user: any, targetGroupId: number, role: string) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    const result = await this.source.addGroup(new PreemptEvent<any>('content.addGroup', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { targetGroupId, role } }), this.id, targetGroupId, role);
    return { success: true, role: result };
  }

  async removeGroupRole(user: any, targetGroupId: number) {
    const isAdmin = user?.is_admin === true;
    const userRole = this.users?.find(u => u.username === user?.username)?.role;
    const userGroupIds = user?.groups?.map((g: any) => g.id) || [];
    const groupRole = this.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
    if (!isAdmin && userRole !== 'Owner' && groupRole !== 'Owner') {
      return { error: "Forbidden: Only Owners can manage roles", status: 403 };
    }
    await this.source.removeGroup(new PreemptEvent<any>('content.removeGroup', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { targetGroupId } }), this.id, targetGroupId);
    return { success: true };
  }
}
