import { pool } from "../db.js";
import { buildContentQuery, applyEditorTemplateOverride, checkContentSecurity, populateContentHandlers, populateContentComponents } from "../utils/contentUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "../utils/editorUtils.js";
import { Tag } from "./tag.js";
import { validateUserRoles } from "../middleware/auth.js";
import * as contentSource from "../sources/contentSource.js";

export class Content {
  id: number;
  author_id: string;
  payload: any;
  template_payload: any;
  headers: string | null;
  is_visible: boolean;
  live_date: Date | null;
  approved_roles: string[];
  resolved_template_id: number;
  created_at: Date;
  updated_at: Date;

  constructor(data: any) {
    this.id = data.id;
    this.author_id = data.author_id;
    this.payload = data.payload;
    this.template_payload = data.template_payload;
    this.headers = data.headers;
    this.is_visible = data.is_visible;
    this.live_date = data.live_date;
    this.approved_roles = data.approved_roles || [];
    this.resolved_template_id = data.resolved_template_id;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  static async getById(id: number) {
    const row = await contentSource.dbGetContentById(id);
    if ('error' in row) return row;
    return new Content(row);
  }

  static async getHeaders(id: number) {
    return await contentSource.dbGetContentHeaders(id);
  }

  static async getWithTemplate(contentId: number, templateId: number | null, tagsParam: string | null, editorMode: string | null = null, user: any = null) {
    const { query, params } = buildContentQuery(contentId, templateId, tagsParam, editorMode);
    const row = await contentSource.dbGetContentQuery(query, params);
    if ('error' in row) return row;

    const content = new Content(row);

    if (editorMode) {
      await applyEditorTemplateOverride(row);
      content.template_payload = row.template_payload;
    } else if (!(await checkContentSecurity(content.resolved_template_id, editorMode))) {
      return { error: "Security check failed", status: 403 };
    }

    const isAuthor = user?.username === content.author_id;
    const isAdmin = user?.is_admin === true;
    const now = new Date();

    if (!isAuthor && !isAdmin) {
      if (!content.is_visible) {
        return { error: "Forbidden: Content is not visible", status: 403 };
      }
      if (content.live_date && new Date(content.live_date) > now) {
        return { error: "Forbidden: Content is not live yet", status: 403 };
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

  static async getLatest(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}) {
    const rows = await contentSource.dbGetLatestContent(criteria);
    return rows.map(r => new Content(r));
  }

  static async getCount(criteria: { tags?: string[]; author?: string } = {}) {
    return await contentSource.dbGetContentCount(criteria);
  }

  static async stage(user: any, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[] = [], groupIds: number[] = []) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let isStagedRow = false;
      if (originalId) {
        isStagedRow = await contentSource.dbGetContentForStaging(client, originalId);
      }

      let row;
      if (isStagedRow) {
        row = await contentSource.dbUpdateStagedContent(client, user.username, payload, headers, originalId!, batchId);
      } else {
        row = await contentSource.dbInsertStagedContent(client, user.username, payload, headers, originalId, batchId);
      }
      
      const content = new Content(row);

      if (tags && Array.isArray(tags)) {
        if (isStagedRow || tags.length > 0) {
          await Tag.updateContentTags(client, content.id, tags);
        }
      }
      if (groupIds && Array.isArray(groupIds)) {
        if (isStagedRow || groupIds.length > 0) {
          await Tag.updateContentTemplateGroups(client, content.id, groupIds);
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

  static async create(user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can create content directly", status: 403 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await contentSource.dbCreateContent(client, user.username, payload, headers, isVisible, liveDate || new Date());
      const content = new Content(row);
      
      if (tags && tags.length > 0) {
        await Tag.updateContentTags(client, content.id, tags);
      }
      if (groupIds) {
        await Tag.updateContentTemplateGroups(client, content.id, groupIds);
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

  async update(user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null): Promise<{ error: string, status: number } | { content: Content }> {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can update content directly", status: 403 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      if (!user.is_admin && this.author_id !== user.username) {
        await client.query('ROLLBACK');
        return { error: "Forbidden: You do not own this content", status: 403 };
      }

      const row = await contentSource.dbUpdateContent(client, this.id, payload, headers, isVisible, liveDate || new Date());
      if ('error' in row) {
        await client.query('ROLLBACK');
        return row;
      }
      Object.assign(this, row);
      
      await Tag.updateContentTags(client, this.id, tags || []);
      await Tag.updateContentTemplateGroups(client, this.id, groupIds || []);
      
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
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can delete content", status: 403 };
    }
    
    try {
      if (!user.is_admin && this.author_id !== user.username) {
        return { error: "Forbidden: You do not own this content", status: 403 };
      }

      const row = await contentSource.dbDeleteContent(this.id);
      if ('error' in row) return row;
      return { success: true };
    } catch (err: any) {
      throw err;
    }
  }
}
