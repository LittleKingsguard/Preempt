import * as userSource from "../sources/userSource.js";

export class User {
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

  constructor(data: any) {
    this.username = data.username;
    this.email = data.email;
    this.is_admin = data.is_admin;
    this.is_contributor = data.is_contributor;
    this.is_trusted_dev = data.is_trusted_dev;
    this.is_2fa_enabled = data.is_2fa_enabled;
    this.is_shadowed = data.is_shadowed;
    this.has_verified = data.has_verified;
    this.is_bot = data.is_bot;
    this.home_page = data.home_page;
  }

  static async authenticate(username: string, passwordPlain: string) {
    const row = await userSource.dbAuthenticateUser(username, passwordPlain);
    if (!row) return null;
    return new User(row);
  }

  static async create(username: string, email: string, passwordPlain: string) {
    try {
      const row = await userSource.dbCreateUser(username, email, passwordPlain);
      return { user: new User(row) };
    } catch (err: any) {
      if (err.code === '23505') { // Unique constraint violation
        return { error: "Username or email already exists" };
      }
      throw err;
    }
  }

  static async getByEmail(email: string) {
    const row = await userSource.dbGetUserByEmail(email);
    if ('error' in row) return row;
    return new User(row);
  }

  static async getByUsername(username: string) {
    const row = await userSource.dbGetUserByUsername(username);
    if ('error' in row) return row;
    return new User(row);
  }

  async updatePassword(newPasswordPlain: string) {
    await userSource.dbUpdatePassword(this.username, newPasswordPlain);
  }

  static async createAuthToken(username: string, type: string, tokenValue: string, expiresInMinutes: number) {
    await userSource.dbCreateAuthToken(username, type, tokenValue, expiresInMinutes);
  }

  static async verifyAuthToken(username: string, type: string, tokenValue: string) {
    return await userSource.dbVerifyAuthToken(username, type, tokenValue);
  }

  static async deleteAuthTokens(username: string, type: string) {
    await userSource.dbDeleteAuthTokens(username, type);
  }

  async verifyEmail() {
    await userSource.dbVerifyUserEmail(this.username);
  }

  async updateRoles(roles: { is_contributor?: boolean, is_bot?: boolean, is_shadowed?: boolean }) {
    await userSource.dbUpdateUserRoles(this.username, roles);
  }

  async updateHomePage(homePage: number | null) {
    await userSource.dbUpdateUserHomePage(this.username, homePage);
  }

  static async getAll() {
    const rows = await userSource.dbGetUsers();
    return rows.map(r => new User(r));
  }
}
