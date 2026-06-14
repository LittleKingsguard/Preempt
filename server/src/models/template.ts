import { Tag } from "./tag.js";
import { resolveEditorTemplateId, fetchTemplateRecord, populateTemplateHandlers, populateTemplateComponents } from "../utils/templateUtils.js";
import { checkHasEditorTag, injectEditorDependencies } from "../utils/editorUtils.js";
import { Node } from "../../../src/core/Node.js";
import { validateUserRoles } from "../middleware/auth.js";
import { pgTemplateSource } from "../sources/templateSource.js";
import { pgHandlerSource } from "../sources/handlerSource.js";
import { pgComponentSource } from "../sources/componentSource.js";
import { pgTagSource } from "../sources/tagSource.js";
import type { IContentData, IContentSource, IHandlerSource, IComponentSource } from "./interfaces.js";

export class Template {
  source: IContentSource;
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

  constructor(data: IContentData, source: IContentSource = pgTemplateSource) {
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

  static async getById(source: IContentSource = pgTemplateSource, id: number, editorMode: string | null = null, user: any = null, handlerSource: IHandlerSource = pgHandlerSource, componentSource: IComponentSource = pgComponentSource) {
    const templateIdToFetch = await resolveEditorTemplateId(id, editorMode);
    const row = await fetchTemplateRecord(templateIdToFetch);
    if ('error' in row) return row;

    const template = new Template(row, source);

    const authErr = validateUserRoles(user, template.approved_roles || [], template.author_id);
    if (authErr) return authErr;

    await populateTemplateHandlers(template.payload, template.id, user, handlerSource, componentSource);
    await populateTemplateComponents(template.payload, template.id, user, componentSource);

    if (editorMode) {
      const hasEditorTag = await checkHasEditorTag(template.id);
      await injectEditorDependencies(template.payload, null, editorMode, hasEditorTag);
    }

    return { template };
  }

  static async create(source: IContentSource = pgTemplateSource, authorId: string, payload: any, tags: string[], groupId: number | null = null) {
    const virtualNode = new Node(payload);
    if (!virtualNode.validate(true)) {
      return { error: "Validation Error", status: 400 };
    }

    const row = await source.create(authorId, payload, null, true, null, tags, groupId ? [groupId] : []);
    if ('error' in row) return row;
    
    const template = new Template(row, source);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    
    return { template };
  }

  async update(user: any, payload: any, tags: string[], groupId: number | null = null): Promise<{ error: string, status: number } | { template: Template }> {
    const virtualNode = new Node(payload);
    if (!virtualNode.validate(true)) {
      return { error: "Validation Error", status: 400 };
    }

    if (this.author_id !== user.username && !user.is_admin) {
      return { error: "Forbidden: Not the author", status: 403 };
    }

    const row = await this.source.update(this.id, this.author_id, payload, null, true, null, tags, groupId ? [groupId] : []);
    if ('error' in row) return row;
    
    Object.assign(this, row);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    
    return { template: this };
  }

  static async stage(source: IContentSource = pgTemplateSource, user: any, payload: any, originalId: number | null, batchId: number, tags: string[] = [], groupId: number | null = null) {
    const virtualNode = new Node(payload);
    if (!virtualNode.validate(true)) {
      return { error: "Validation Error", status: 400 };
    }

    const row = await source.stage(user.username, payload, null, originalId, batchId, tags, groupId ? [groupId] : []);
    if ('error' in row) return row;
    
    const template = new Template(row, source);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    
    return { template };
  }
}
