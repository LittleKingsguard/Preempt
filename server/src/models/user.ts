import { PreemptEvent } from "../../../src/types/Event.js";
import { pgUserSource } from "../sources/userSource.js";
import { pgAuthTokenSource } from "../sources/authTokenSource.js";
import type { IUserData, IUserSource, IAuthTokenSource } from "./interfaces.js";

export class User {
  source: IUserSource;
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

  constructor(data: IUserData, source: IUserSource = pgUserSource) {
    this.source = source;
    this.username = data.username;
    this.email = data.email;
    this.is_admin = data.is_admin || false;
    this.is_contributor = data.is_contributor || false;
    this.is_trusted_dev = data.is_trusted_dev || false;
    this.is_2fa_enabled = data.is_2fa_enabled || false;
    this.is_shadowed = data.is_shadowed || false;
    this.has_verified = data.has_verified || false;
    this.is_bot = data.is_bot || false;
    this.home_page = data.home_page || null;
    this.validated_hosts = data.validated_hosts || [];
  }

  static async authenticate(source: IUserSource = pgUserSource, username: string, passwordPlain: string) {
    const row = await source.authenticate(new PreemptEvent<any>('user.authenticate', { id: 'system', type: 'process' }, [], { before: null, after: { username } }), username, passwordPlain);
    if (!row) return null;
    if ('error' in row) return row;
    return new User(row, source);
  }

  static async create(source: IUserSource = pgUserSource, username: string, email: string, passwordPlain: string) {
    const row = await source.create(new PreemptEvent<any>('user.create', { id: 'system', type: 'process' }, [], { before: null, after: { username, email } }), username, email, passwordPlain);
    if (row && 'error' in row) return row;
    return { user: new User(row, source) };
  }

  static async getByEmail(source: IUserSource = pgUserSource, email: string) {
    const row = await source.getByEmail(new PreemptEvent<any>('user.getByEmail', { id: 'system', type: 'process' }, [], { before: null, after: { email } }), email);
    if ('error' in row) return row;
    return new User(row, source);
  }

  static async getByUsername(source: IUserSource = pgUserSource, username: string, criteria?: { format?: 'raw' | 'content' }) {
    const row = await source.getByUsername(new PreemptEvent<any>('user.getByUsername', { id: 'system', type: 'process' }, [], { before: null, after: { username } }), username, criteria);
    if ('error' in row) return row;
    if (criteria?.format === 'content') return row;
    return new User(row, source);
  }

  async updatePassword(newPasswordPlain: string) {
    return await this.source.updatePassword(new PreemptEvent<any>('user.updatePassword', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username: this.username } }), this.username, newPasswordPlain);
  }

  static async createAuthToken(tokenSource: IAuthTokenSource = pgAuthTokenSource, username: string, type: string, tokenValue: string, expiresInMinutes: number) {
    return await tokenSource.create(new PreemptEvent<any>('auth.create', { id: username, type: 'user' }, [], { before: null, after: { username, type, tokenValue } }), username, type, tokenValue, expiresInMinutes);
  }

  static async verifyAuthToken(tokenSource: IAuthTokenSource = pgAuthTokenSource, username: string, type: string, tokenValue: string) {
    return await tokenSource.verify(new PreemptEvent<any>('auth.verify', { id: username, type: 'user' }, [], { before: null, after: { username, type } }), username, type, tokenValue);
  }

  static async deleteAuthTokens(tokenSource: IAuthTokenSource = pgAuthTokenSource, username: string, type: string) {
    return await tokenSource.delete(new PreemptEvent<any>('auth.delete', { id: username, type: 'user' }, [], { before: null, after: { username, type } }), username, type);
  }

  async verifyEmail() {
    return await this.source.verifyEmail(new PreemptEvent<any>('user.verifyEmail', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username: this.username } }), this.username);
  }

  async updateRoles(roles: { is_admin?: boolean, is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
    return await this.source.updateRoles(new PreemptEvent<any>('user.updateRoles', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username: this.username, roles } }), this.username, roles);
  }

  async updateHomePage(homePage: number | null) {
    return await this.source.updateHomePage(new PreemptEvent<any>('user.updateHomePage', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username: this.username, homePage } }), this.username, homePage);
  }

  async addValidatedHost(host: string) {
    await this.source.addValidatedHost(new PreemptEvent<any>('user.addValidatedHost', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { username: this.username, host } }), this.username, host);
    if (!this.validated_hosts.includes(host)) {
      this.validated_hosts.push(host);
    }
  }

  static async getAll(source: IUserSource = pgUserSource, criteria?: { format?: 'raw' | 'content' }) {
    const rows = await source.getAll(new PreemptEvent<any>('user.getAll', { id: 'system', type: 'process' }), criteria);
    if (criteria?.format === 'content') return rows;
    return rows.map((r: any) => new User(r, source));
  }

  static async hasAdmin(source: IUserSource = pgUserSource): Promise<boolean> {
    return await source.hasAdmin(new PreemptEvent<any>('user.hasAdmin', { id: 'system', type: 'process' }));
  }
}
