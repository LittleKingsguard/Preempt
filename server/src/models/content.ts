import { pool } from "../db.js";
import { buildContentQuery, applyEditorTemplateOverride, checkContentSecurity, populateContentHandlers, populateContentComponents } from "../utils/contentUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "../utils/editorUtils.js";
import { Tag } from "./tag.js";
import { validateUserRoles } from "../middleware/auth.js";
import { pgContentSource } from "../sources/contentSource.js";
import { pgTagSource } from "../sources/tagSource.js";
import type { IContentData, IContentSource } from "./interfaces.js";

export class Content {
  source: IContentSource;
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

  constructor(data: IContentData, source: IContentSource = pgContentSource) {
    this.source = source;
    this.id = data.id;
    this.author_id = data.author_id;
    this.payload = data.payload;
    this.template_payload = data.template_payload;
    this.headers = data.headers || null;
    this.is_visible = data.is_visible || false;
    this.live_date = data.live_date || null;
    this.approved_roles = data.approved_roles || [];
    this.resolved_template_id = data.resolved_template_id;
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
  }

  static async getById(source: IContentSource = pgContentSource, id: number) {
    const row = await source.getById(id);
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

  static async getLatest(source: IContentSource = pgContentSource, criteria: { tags?: string[]; author?: string; limit?: number; offset?: number } = {}) {
    const rows = await source.getLatest(criteria);
    return rows.map(r => new Content(r, source));
  }

  static async getCount(source: IContentSource = pgContentSource, criteria: { tags?: string[]; author?: string } = {}) {
    return await source.getCount(criteria);
  }

  static async stage(source: IContentSource = pgContentSource, user: any, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[] = [], groupIds: number[] = []) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let isStagedRow = false;
      if (originalId) {
        isStagedRow = await source.getForStaging(client, originalId);
      }

      let row;
      if (isStagedRow) {
        row = await source.updateStaged(client, user.username, payload, headers, originalId!, batchId);
      } else {
        row = await source.insertStaged(client, user.username, payload, headers, originalId, batchId);
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

  static async create(source: IContentSource = pgContentSource, user: any, payload: any, headers: string | null, tags: string[] = [], groupIds: number[] = [], isVisible: boolean = true, liveDate: string | null = null) {
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can create content directly", status: 403 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await source.create(client, user.username, payload, headers, isVisible, liveDate ? new Date(liveDate) : new Date());
      const content = new Content(row, source);
      
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

      const row = await this.source.update(client, this.id, payload, headers, isVisible, liveDate ? new Date(liveDate) : new Date());
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
    if (!user || (!user.is_admin && !user.is_contributor)) {
      return { error: "Forbidden: Only admins and contributors can delete content", status: 403 };
    }
    
    try {
      if (!user.is_admin && this.author_id !== user.username) {
        return { error: "Forbidden: You do not own this content", status: 403 };
      }

      const row = await this.source.delete(this.id);
      if ('error' in row) return row;
      return { success: true };
    } catch (err: any) {
      throw err;
    }
  }
}
