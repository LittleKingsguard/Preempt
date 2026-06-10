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
  }

  static async authenticate(source: IUserSource = pgUserSource, username: string, passwordPlain: string) {
    const row = await source.authenticate(username, passwordPlain);
    if (!row) return null;
    if ('error' in row) return row;
    return new User(row, source);
  }

  static async create(source: IUserSource = pgUserSource, username: string, email: string, passwordPlain: string) {
    const row = await source.create(username, email, passwordPlain);
    if (row && 'error' in row) return row;
    return { user: new User(row, source) };
  }

  static async getByEmail(source: IUserSource = pgUserSource, email: string) {
    const row = await source.getByEmail(email);
    if ('error' in row) return row;
    return new User(row, source);
  }

  static async getByUsername(source: IUserSource = pgUserSource, username: string) {
    const row = await source.getByUsername(username);
    if ('error' in row) return row;
    return new User(row, source);
  }

  async updatePassword(newPasswordPlain: string) {
    return await this.source.updatePassword(this.username, newPasswordPlain);
  }

  static async createAuthToken(tokenSource: IAuthTokenSource = pgAuthTokenSource, username: string, type: string, tokenValue: string, expiresInMinutes: number) {
    return await tokenSource.create(username, type, tokenValue, expiresInMinutes);
  }

  static async verifyAuthToken(tokenSource: IAuthTokenSource = pgAuthTokenSource, username: string, type: string, tokenValue: string) {
    return await tokenSource.verify(username, type, tokenValue);
  }

  static async deleteAuthTokens(tokenSource: IAuthTokenSource = pgAuthTokenSource, username: string, type: string) {
    return await tokenSource.delete(username, type);
  }

  async verifyEmail() {
    return await this.source.verifyEmail(this.username);
  }

  async updateRoles(roles: { is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
    return await this.source.updateRoles(this.username, roles);
  }

  async updateHomePage(homePage: number | null) {
    return await this.source.updateHomePage(this.username, homePage);
  }

  static async getAll(source: IUserSource = pgUserSource) {
    const rows = await source.getAll();
    return rows.map(r => new User(r, source));
  }
}
