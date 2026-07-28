import { PreemptEvent } from "../../../src/types/Event.js";
import { Tag } from "./tag.js";
import { resolveEditorTemplateId, fetchTemplateRecord, populateTemplate } from "../utils/templateUtils.js";
import { Node } from "../../../src/core/Node.js";
import { validateUserRoles } from "../middleware/auth.js";
import { pgTemplateSource } from "../sources/templateSource.js";
import { pgHandlerSource } from "../sources/handlerSource.js";
import { pgComponentSource } from "../sources/componentSource.js";
import { pgTagSource } from "../sources/tagSource.js";
import { pgSettingSource } from "../sources/settingsSource.js";
import type { IContentData, IContentSource, IHandlerSource, IComponentSource } from "./interfaces.js";

/**
 * Domain model wrapping backend layout Template entities.
 *
 * @useCase Fetching, creating, updating, or staging layout templates in database storage.
 * @processFlow Database queries -> schema validation -> Handler & Component dependency resolution -> response payload.
 */
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

  /**
   * Constructs a Template domain object from DB row data.
   *
   * @param data IContentData row schema.
   * @param source Content data source implementation.
   */
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

  /**
   * Retrieves a template by ID, validating role permissions and populating handler/component bindings.
   *
   * @param source Data source provider.
   * @param id Template ID.
   * @param editorMode Optional editor mode parameter.
   * @param user Authenticated user session object.
   * @param handlerSource Handler data source provider.
   * @param componentSource Component data source provider.
   * @returns Template instance object or error response.
   */
  static async getById(source: IContentSource = pgTemplateSource, id: number, editorMode: string | null = null, user: any = null, handlerSource: IHandlerSource = pgHandlerSource, componentSource: IComponentSource = pgComponentSource) {
    const templateIdToFetch = await resolveEditorTemplateId(id, editorMode);
    const row = await fetchTemplateRecord(templateIdToFetch);
    if ('error' in row) return row;

    const template = new Template(row, source);

    const authErr = validateUserRoles(user, template.approved_roles || [], template.author_id);
    if (authErr) return authErr;

    await populateTemplate(template.payload, template.id, user, handlerSource, componentSource);

    return { template };
  }

  /**
   * Validates schema and creates a new Template entity.
   *
   * @param source Data source provider.
   * @param authorId Author username string.
   * @param payload Root template JSON schema.
   * @param tags Tag array.
   * @param groupId Optional group ID.
   * @returns New Template instance object or error response.
   */
  static async create(source: IContentSource = pgTemplateSource, authorId: string, payload: any, tags: string[], groupId: number | null = null) {
    const virtualNode = new Node(payload, null, 0);
    if (!virtualNode.isValid) {
      return { error: "Validation Error", status: 400 };
    }

    const row = await source.create(new PreemptEvent<any>('template.create', { id: 'system', type: 'process' }, [], { before: null, after: { authorId, payload, tags, groupId } }), authorId, payload, null, true, null, tags, groupId ? [groupId] : []);
    if ('error' in row) return row;
    
    const template = new Template(row, source);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    
    return { template };
  }

  /**
   * Updates an existing Template entity after author permission and schema validation.
   *
   * @param user Authenticated user session.
   * @param payload Updated template JSON schema.
   * @param tags Updated tag array.
   * @param groupId Optional group ID.
   * @returns Updated Template object or error response.
   */
  async update(user: any, payload: any, tags: string[], groupId: number | null = null): Promise<{ error: string, status: number } | { template: Template }> {
    const virtualNode = new Node(payload, null, 0);
    if (!virtualNode.isValid) {
      return { error: "Validation Error", status: 400 };
    }

    if (this.author_id !== user.username && !user.is_admin) {
      return { error: "Forbidden: Not the author", status: 403 };
    }

    const row = await this.source.update(new PreemptEvent<any>('template.update', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { payload, tags, groupId } }), this.id, this.author_id, payload, null, true, null, tags, groupId ? [groupId] : []);
    if ('error' in row) return row;
    
    Object.assign(this, row);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    
    return { template: this };
  }

  /**
   * Stages a Template update inside a ChangeBatch review queue.
   *
   * @param source Data source provider.
   * @param user Authenticated user.
   * @param payload Template JSON payload.
   * @param originalId Original Template ID being modified.
   * @param batchId Target ChangeBatch ID.
   * @param tags Tag array.
   * @param groupId Group ID.
   * @returns Staged Template object or error response.
   */
  static async stage(source: IContentSource = pgTemplateSource, user: any, payload: any, originalId: number | null, batchId: number, tags: string[] = [], groupId: number | null = null) {
    const virtualNode = new Node(payload, null, 0);
    if (!virtualNode.isValid) {
      return { error: "Validation Error", status: 400 };
    }

    const row = await source.stage(new PreemptEvent<any>('template.stage', { id: 'system', type: 'process' }, [], { before: null, after: { payload, originalId, batchId, tags, groupId } }), user.username, payload, null, originalId, batchId, tags, groupId ? [groupId] : []);
    if ('error' in row) return row;
    
    const template = new Template(row, source);
    if (tags && tags.length > 0) {
      Tag.addTagsToCache(tags);
    }
    
    return { template };
  }
}

