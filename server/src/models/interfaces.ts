import type { IPreemptEvent } from "../../../src/types/Event.js";
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
  getAll(event: IPreemptEvent, criteria?: { templateId?: number; contentId?: number }): Promise<any[]>;
  getById(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;
  create(event: IPreemptEvent, name: string, payload: any, authorId: string): Promise<any>;
  update(event: IPreemptEvent, id: number, name: string, payload: any): Promise<any | { error: string; status: number }>;
  delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;
  updateTemplateComponents(event: IPreemptEvent, client: any, templateId: number, componentNames: string[]): Promise<void>;
  updateContentComponents(event: IPreemptEvent, client: any, contentId: number, componentNames: string[]): Promise<void>;
  stage(event: IPreemptEvent, name: string, payload: any, authorId: string, originalId: number | null, batchId: number): Promise<any>;
}

export interface IContentUserData {
  content_id: number;
  username: string;
  role: string;
}

export interface IContentUserGroupData {
  content_id: number;
  group_id: number;
  role: string;
}

export interface IUserGroupData {
  id: number;
  name: string;
}

export interface IUserGroupMemberData {
  group_id: number;
  username: string;
}

export interface IUserGroupSource {
  getAll(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }): Promise<any>;
  getById(event: IPreemptEvent, id: number, criteria?: { format?: 'raw' | 'content' }): Promise<any | { error: string; status: number }>;
  create(event: IPreemptEvent, name: string): Promise<IUserGroupData | { error: string; status: number }>;
  delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;
  getMembers(event: IPreemptEvent, groupId: number): Promise<IUserGroupMemberData[]>;
  addMember(event: IPreemptEvent, groupId: number, username: string | string[]): Promise<void>;
  removeMember(event: IPreemptEvent, groupId: number, username: string): Promise<void>;
  getUserGroups(event: IPreemptEvent, username: string): Promise<IUserGroupData[]>;
}

export interface IContentData {
  id: number;
  author_id: string;
  payload: any;
  template_payload?: any;
  promo?: any;
  metadata?: any;
  headers: string | null;
  is_visible: boolean;
  live_date: Date | null;
  approved_roles?: string[];
  resolved_template_id: number;
  change_batch_id?: number | null;
  group_id?: number | null;
  original_id?: number | null;
  is_approved?: boolean;
  tags?: string[];
  template_group_id?: number | null;
  created_at?: Date;
  updated_at?: Date;
  users?: IContentUserData[];
  groups?: IContentUserGroupData[];
}

export interface IContentSource {
  get(event: IPreemptEvent, criteria: { count_only?: boolean; id?: number; hide_pattern?: 'Overlook' | 'Paywall' | 'Guard'; tags?: string[]; author?: string; limit?: number; offset?: number; list_id?: number; columns?: string[]; format?: 'raw' | 'content' }, user?: any, placeholder?: any): Promise<any>;
  getHeaders(event: IPreemptEvent, id: number): Promise<any>;
  query(event: IPreemptEvent, query: string, params: any[]): Promise<any | { error: string; status: number }>;
  stage(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, originalId: number | null, batchId: number, tags: string[], groupIds: number[], promo?: any, metadata?: any): Promise<any>;
  create(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any, metadata?: any): Promise<any>;
  update(event: IPreemptEvent, id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any, metadata?: any): Promise<any | { error: string; status: number }>;
  delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;

  addUser(event: IPreemptEvent, contentId: number, username: string, role: string): Promise<any>;
  removeUser(event: IPreemptEvent, contentId: number, username: string): Promise<void>;
  getUsers(event: IPreemptEvent, contentId: number): Promise<IContentUserData[]>;

  addGroup(event: IPreemptEvent, contentId: number, groupId: number, role: string): Promise<any>;
  removeGroup(event: IPreemptEvent, contentId: number, groupId: number): Promise<void>;
  getGroups(event: IPreemptEvent, contentId: number): Promise<IContentUserGroupData[]>;
  getSubjectContext?(event: IPreemptEvent, commentListId: number): Promise<any>;
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
  getAll(event: IPreemptEvent, criteria?: { templateId?: number; contentId?: number; componentIds?: number[]; format?: 'raw' | 'content' }): Promise<any[]>;
  getById(event: IPreemptEvent, id: number, criteria?: { format?: 'raw' | 'content' }): Promise<any | { error: string; status: number }>;
  create(event: IPreemptEvent, name: string, body: string, authorId: string, isApproved: boolean): Promise<any>;
  update(event: IPreemptEvent, id: number, name: string, body: string): Promise<any | { error: string; status: number }>;
  delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;
  updateTemplateHandlers(event: IPreemptEvent, templateId: number, handlerNames: string[]): Promise<void>;
  updateContentHandlers(event: IPreemptEvent, contentId: number, handlerNames: string[]): Promise<void>;
  stage(event: IPreemptEvent, name: string, body: string, authorId: string, originalId: number | null, batchId: number): Promise<any>;
  approve(event: IPreemptEvent, id: number, isApproved: boolean): Promise<any | { error: string; status: number }>;
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
  validated_hosts: string[];
}

export interface IUserSource {
  authenticate(event: IPreemptEvent, username: string, passwordPlain: string): Promise<any | null>;
  create(event: IPreemptEvent, username: string, email: string, passwordPlain: string): Promise<any>;
  getByEmail(event: IPreemptEvent, email: string): Promise<any | { error: string; status: number }>;
  getByUsername(event: IPreemptEvent, username: string, criteria?: { format?: 'raw' | 'content' }): Promise<any | { error: string; status: number }>;
  updatePassword(event: IPreemptEvent, username: string, newPasswordPlain: string): Promise<void>;
  verifyEmail(event: IPreemptEvent, username: string): Promise<void>;
  updateRoles(event: IPreemptEvent, username: string, roles: { is_contributor?: boolean; is_bot?: boolean; is_shadowed?: boolean }): Promise<void | { error: string; status: number }>;
  updateHomePage(event: IPreemptEvent, username: string, homePage: number | null): Promise<void>;
  addValidatedHost(event: IPreemptEvent, username: string, host: string): Promise<void>;
  getAll(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }): Promise<any>;
}

export interface IAuthTokenSource {
  create(event: IPreemptEvent, username: string, type: string, tokenValue: string, expiresInMinutes: number): Promise<void>;
  verify(event: IPreemptEvent, username: string, type: string, tokenValue: string): Promise<any>;
  delete(event: IPreemptEvent, username: string, type: string): Promise<void>;
}

export interface IChangeBatchData {
  id: number;

  description: string;
  author_id: string;
  created_at?: Date;
  merged_at?: Date | null;
}

export interface IChangeBatchSource {
  create(event: IPreemptEvent, authorId: string, description: string): Promise<any>;
  getPending(event: IPreemptEvent): Promise<any[]>;
  getById(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;
  delete(event: IPreemptEvent, id: number): Promise<any | { error: string; status: number }>;
  markMerged(event: IPreemptEvent, batchId: number): Promise<any | { error: string; status: number }>;
  approve(event: IPreemptEvent, batchId: number): Promise<any>;
}

export interface ITagData {
  name: string;
}

export interface ITagSource {
  fetchAll(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }): Promise<any>;
  updateTemplateTags(event: IPreemptEvent, client: any, templateId: number, tags: string[]): Promise<void>;
  updateContentTags(event: IPreemptEvent, client: any, contentId: number, tags: string[]): Promise<void>;
}

export interface ISettingData {
  key: string;
  value: string;
}

export interface ISettingSource {
  get(event: IPreemptEvent, key: string, criteria?: { format?: 'raw' | 'content' }): Promise<any>;
  getAll?(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }): Promise<any>;
  set(event: IPreemptEvent, key: string, valueStr: string): Promise<void>;
}
