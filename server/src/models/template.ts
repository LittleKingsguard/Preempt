import { pool } from "../db.js";
import { Tag } from "./tag.js";
import { resolveEditorTemplateId, fetchTemplateRecord, populateTemplateHandlers, populateTemplateComponents } from "../utils/templateUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "../utils/editorUtils.js";
import { Node } from "../../../src/core/Node.js";
import { validateUserRoles } from "../middleware/auth.js";
import { pgTemplateSource } from "../sources/templateSource.js";
import { pgTagSource } from "../sources/tagSource.js";
import type { ITemplateData, ITemplateSource } from "./interfaces.js";

export class Template {
  source: ITemplateSource;
  id: number;
  payload: any;
  author_id: string;
  approved_roles: string[];
  group_id: number | null;
  change_batch_id: number | null;
  original_id: number | null;
  is_approved: boolean;
  created_at: Date;
  updated_at: Date;

  constructor(data: ITemplateData, source: ITemplateSource = pgTemplateSource) {
    this.source = source;
    this.id = data.id;
    this.payload = data.payload;
    this.author_id = data.author_id;
    this.approved_roles = data.approved_roles || [];
    this.group_id = data.group_id || null;
    this.change_batch_id = data.change_batch_id || null;
    this.original_id = data.original_id || null;
    this.is_approved = data.is_approved || false;
    this.created_at = data.created_at || new Date();
    this.updated_at = data.updated_at || new Date();
  }

  static async getById(source: ITemplateSource = pgTemplateSource, id: number, editorMode: string | null = null, user: any = null) {
    const templateIdToFetch = await resolveEditorTemplateId(id, editorMode);
    const row = await fetchTemplateRecord(templateIdToFetch);
    if ('error' in row) return row;

    const template = new Template(row, source);

    const authErr = validateUserRoles(user, template.approved_roles || [], template.author_id);
    if (authErr) return authErr;

    await populateTemplateHandlers(template.payload, template.id, user);
    await populateTemplateComponents(template.payload, template.id, user);

    if (editorMode) {
      const hasEditorTag = await checkHasEditorTag(template.id);
      await injectEditorDependencies(template.payload, null, editorMode, hasEditorTag);
    }

    return { template };
  }

  static async create(source: ITemplateSource = pgTemplateSource, authorId: string, payload: any, tags: string[], groupId: number | null = null) {
    const virtualNode = new Node(payload);
    if (!virtualNode.validate(true)) {
      return { error: "Validation Error", status: 400 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await source.create(client, authorId, payload, groupId);
      const template = new Template(row, source);
      if (tags && Array.isArray(tags)) {
        await Tag.updateTemplateTags(pgTagSource, client, template.id, tags);
      }
      await client.query('COMMIT');
      return { template };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(user: any, payload: any, tags: string[], groupId: number | null = null): Promise<{ error: string, status: number } | { template: Template }> {
    const virtualNode = new Node(payload);
    if (!virtualNode.validate(true)) {
      return { error: "Validation Error", status: 400 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      if (this.author_id !== user.username && !user.is_admin) {
        await client.query('ROLLBACK');
        return { error: "Forbidden: Not the author", status: 403 };
      }

      const row = await this.source.update(client, this.id, payload, groupId);
      if ('error' in row) {
        await client.query('ROLLBACK');
        return row;
      }
      Object.assign(this, row);
      
      if (tags && Array.isArray(tags)) {
        await Tag.updateTemplateTags(pgTagSource, client, this.id, tags);
      }
      await client.query('COMMIT');
      return { template: this };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async stage(source: ITemplateSource = pgTemplateSource, user: any, payload: any, originalId: number | null, batchId: number, tags: string[] = [], groupId: number | null = null) {
    const virtualNode = new Node(payload);
    if (!virtualNode.validate(true)) {
      return { error: "Validation Error", status: 400 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let actualGroupId = groupId;
      let isStagedRow = false;
      
      if (originalId) {
        const origRow = await source.getForStaging(client, originalId);
        if ('error' in origRow) {
          await client.query('ROLLBACK');
          return origRow;
        }
        if (!actualGroupId) actualGroupId = origRow.group_id;
        if (origRow.change_batch_id !== null && origRow.merged_at === null) isStagedRow = true;
      }

      let row;
      if (isStagedRow) {
        row = await source.updateStaged(client, originalId!, actualGroupId, payload, batchId);
      } else {
        row = await source.insertStaged(client, user.username, actualGroupId, payload, originalId, batchId);
      }

      if ('error' in row) {
        await client.query('ROLLBACK');
        return row;
      }
      
      const template = new Template(row, source);

      if (tags && Array.isArray(tags)) {
        if (isStagedRow || tags.length > 0) {
          await Tag.updateTemplateTags(pgTagSource, client, template.id, tags);
        }
      }
      await client.query('COMMIT');
      return { template };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
