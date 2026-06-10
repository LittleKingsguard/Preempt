export interface IComponentData {
  id: number;
  name: string;
  payload: any;
  author_id: string;
  approved_roles?: string[];
  created_at?: Date;
  updated_at?: Date;
}

export interface IComponentSource {
  getAll(): Promise<any[]>;
  getById(id: number): Promise<any | { error: string; status: number }>;
  create(name: string, payload: any, authorId: string): Promise<any>;
  update(id: number, name: string, payload: any): Promise<any | { error: string; status: number }>;
  delete(id: number): Promise<any | { error: string; status: number }>;
  updateTemplateComponents(client: any, templateId: number, componentNames: string[]): Promise<void>;
  updateContentComponents(client: any, contentId: number, componentNames: string[]): Promise<void>;
  stage(name: string, payload: any, authorId: string, originalId: number | null, batchId: number): Promise<any>;
}

export interface IContentData {
  id: number;
  author_id: string;
  payload: any;
  template_payload?: any;
  headers: string | null;
  is_visible: boolean;
  live_date: Date | null;
  approved_roles?: string[];
  resolved_template_id: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface IContentSource {
  getById(id: number): Promise<any | { error: string; status: number }>;
  getHeaders(id: number): Promise<any>;
  query(query: string, params: any[]): Promise<any | { error: string; status: number }>;
  getLatest(criteria: { tags?: string[]; author?: string; limit?: number; offset?: number }): Promise<any[]>;
  getCount(criteria: { tags?: string[]; author?: string }): Promise<any>;
  getForStaging(client: any, originalId: number): Promise<boolean>;
  updateStaged(client: any, authorId: string, payload: any, headers: string | null, originalId: number, batchId: number): Promise<any>;
  insertStaged(client: any, authorId: string, payload: any, headers: string | null, originalId: number | null, batchId: number): Promise<any>;
  create(client: any, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date): Promise<any>;
  update(client: any, id: number, payload: any, headers: string | null, isVisible: boolean, liveDate: Date): Promise<any | { error: string; status: number }>;
  delete(id: number): Promise<any | { error: string; status: number }>;
  updateTemplateGroups(client: any, contentId: number, groupIds: number[]): Promise<void>;
}

export interface IHandlerData {
  id: number;
  name: string;
  body: string;
  author_id: string;
  is_approved?: boolean;
  approved_roles?: string[];
  created_at?: Date;
  updated_at?: Date;
}

export interface IHandlerSource {
  getAll(): Promise<any[]>;
  getById(id: number): Promise<any | { error: string; status: number }>;
  create(name: string, body: string, authorId: string, isApproved: boolean): Promise<any>;
  update(id: number, name: string, body: string): Promise<any | { error: string; status: number }>;
  delete(id: number): Promise<any | { error: string; status: number }>;
  updateTemplateHandlers(client: any, templateId: number, handlerNames: string[]): Promise<void>;
  updateContentHandlers(client: any, contentId: number, handlerNames: string[]): Promise<void>;
  stage(name: string, body: string, authorId: string, originalId: number | null, batchId: number): Promise<any>;
  approve(id: number, isApproved: boolean): Promise<any | { error: string; status: number }>;
}

export interface ITemplateData {
  id: number;
  group_id: number;
  payload: any;
  author_id: string;
  change_batch_id?: number | null;
  original_id?: number | null;
  is_approved?: boolean;
  approved_roles?: string[];
  created_at?: Date;
  updated_at?: Date;
}

export interface ITemplateSource {
  getById(id: number): Promise<any | { error: string; status: number }>;
  getForGroup(groupId: number): Promise<any[]>;
  getAll(): Promise<any[]>;
  getAuthorId(client: any, templateId: number): Promise<string | { error: string; status: number }>;
  create(client: any, authorId: string, payload: any, groupId: number | null): Promise<any>;
  update(client: any, id: number, payload: any, groupId: number | null): Promise<any | { error: string; status: number }>;
  delete(id: number): Promise<any | { error: string; status: number }>;
  getForStaging(client: any, originalId: number): Promise<any | { error: string; status: number }>;
  updateStaged(client: any, originalId: number, actualGroupId: number | null, payload: any, batchId: number): Promise<any>;
  insertStaged(client: any, authorId: string, groupId: number | null, payload: any, originalId: number | null, batchId: number): Promise<any>;
}

export interface IUserData {
  username: string;
  email: string;
  is_admin: boolean;
  is_contributor: boolean;
  is_trusted_dev: boolean;
  is_2fa_enabled: boolean;
  is_shadowed: boolean;
  has_verified: boolean;
  is_bot: boolean;
  home_page: number | null;
}

export interface IUserSource {
  authenticate(username: string, passwordPlain: string): Promise<any | null>;
  create(username: string, email: string, passwordPlain: string): Promise<any>;
  getByEmail(email: string): Promise<any | { error: string; status: number }>;
  getByUsername(username: string): Promise<any | { error: string; status: number }>;
  updatePassword(username: string, newPasswordPlain: string): Promise<void>;
  verifyEmail(username: string): Promise<void>;
  updateRoles(username: string, roles: { is_contributor?: boolean; is_bot?: boolean; is_shadowed?: boolean }): Promise<void | { error: string; status: number }>;
  updateHomePage(username: string, homePage: number | null): Promise<void>;
  getAll(): Promise<any[]>;
}

export interface IAuthTokenSource {
  create(username: string, type: string, tokenValue: string, expiresInMinutes: number): Promise<void>;
  verify(username: string, type: string, tokenValue: string): Promise<any>;
  delete(username: string, type: string): Promise<void>;
}

export interface IChangeBatchData {
  id: number;

  description: string;
  author_id: string;
  created_at?: Date;
  merged_at?: Date | null;
}

export interface IChangeBatchSource {
  create(authorId: string, description: string): Promise<any>;
  getPending(): Promise<any[]>;
  getById(id: number): Promise<any | { error: string; status: number }>;
  delete(id: number): Promise<any | { error: string; status: number }>;
  markMerged(batchId: number): Promise<any | { error: string; status: number }>;
  approve(batchId: number): Promise<any>;
}

export interface ITagData {
  name: string;
}

export interface ITagSource {
  fetchAll(): Promise<string[]>;
  updateTemplateTags(client: any, templateId: number, tags: string[]): Promise<void>;
  updateContentTags(client: any, contentId: number, tags: string[]): Promise<void>;
}

export interface ISettingData {
  key: string;
  value: string;
}

export interface ISettingSource {
  get(key: string): Promise<any>;
  set(key: string, valueStr: string): Promise<void>;
}
