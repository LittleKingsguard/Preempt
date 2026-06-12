import { pool } from '../db.js';
import { queryFirstRow } from '../utils/db.js';
import type { IContentSource, IContentData } from '../models/interfaces.js';
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultMessage: any = null;
let cachedDefaultMessageTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function getDefaultMessageComponent() {
  const now = Date.now();
  if (!cachedDefaultMessage || now - cachedDefaultMessageTimestamp > CACHE_TTL_MS) {
    cachedDefaultMessage = await pgSettingSource.get('default-message');
    cachedDefaultMessageTimestamp = now;
    
    if (!cachedDefaultMessage) {
      cachedDefaultMessage = {
        type: 'div',
        css: { classes: ['message'] },
        content: [
          { type: 'strong', component: [{ reference: 'messageAuthor', target: 'content' }] },
          { type: 'span', component: [{ reference: 'messageDate', target: 'content' }] },
          { type: 'p', component: [{ reference: 'messageBody', target: 'content' }] }
        ]
      };
    }
  }
  return cachedDefaultMessage;
}

function compileMessagesToContent(messageRows: any[], defaultMessageComp: any): IContentData {
  let minCreatedAt = Date.now();
  let maxUpdatedAt = 0;

  if (messageRows.length > 0) {
    minCreatedAt = new Date(messageRows[0].created_at).getTime();
    maxUpdatedAt = new Date(messageRows[0].updated_at).getTime();
  }

  const payload = messageRows.map(messageRow => {
    const cTime = new Date(messageRow.created_at).getTime();
    const uTime = new Date(messageRow.updated_at).getTime();
    if (cTime < minCreatedAt) minCreatedAt = cTime;
    if (uTime > maxUpdatedAt) maxUpdatedAt = uTime;

    let targetPlacement = [];
    if (messageRow.reply_target_id) {
      targetPlacement.push(`message-${messageRow.reply_target_id}`);
    }

    return {
      ...defaultMessageComp,
      placement: targetPlacement.length > 0 ? { targetPlacement } : undefined,
      component: [
        { reference: 'messageAuthor', value: messageRow.author_id },
        { reference: 'messageDate', value: new Date(messageRow.created_at).toISOString() },
        { reference: 'messageBody', value: messageRow.body },
        { reference: 'messageId', value: messageRow.id }
      ]
    };
  });

  return {
    id: messageRows.length > 0 ? messageRows[0].message_list_id : 0,
    author_id: 'system',
    payload: payload,
    headers: null,
    is_visible: true,
    live_date: new Date(),
    resolved_template_id: 0,
    created_at: new Date(minCreatedAt),
    updated_at: new Date(maxUpdatedAt || Date.now()),
    users: [],
    groups: []
  };
}

export async function getMessageListGroup(listId: number) {
  const row = await queryFirstRow("SELECT group_id FROM MessageLists WHERE id = $1", [listId]);
  return row ? row.group_id : null;
}

export async function createMessageList(groupId: number, name?: string) {
  return await queryFirstRow(
    "INSERT INTO MessageLists (name, group_id) VALUES ($1, $2) RETURNING *",
    [name || null, groupId]
  );
}

export async function getMessageAuthor(messageId: number) {
  const row = await queryFirstRow("SELECT author_id FROM Messages WHERE id = $1", [messageId]);
  return row ? row.author_id : null;
}

export const pgMessageSource: IContentSource = {
  async getById(id: number, user?: any) {
    const row = await queryFirstRow("SELECT * FROM Messages WHERE id = $1", [id], "Message not found");
    if (row && !('error' in row)) {
      const defaultComp = await getDefaultMessageComponent();
      return compileMessagesToContent([row], defaultComp);
    }
    return row;
  },

  async query(query: string, params: any[]) {
    const result = await pool.query(query, params);
    const defaultComp = await getDefaultMessageComponent();
    return [compileMessagesToContent(result.rows, defaultComp)];
  },

  async getLatestOverlook(criteria: any, user?: any) {
    let query = "SELECT * FROM Messages";
    const params: any[] = [];
    if (criteria && criteria.list_id) {
      params.push(criteria.list_id);
      query += " WHERE message_list_id = $1 ORDER BY created_at ASC";
    } else {
      query += " ORDER BY created_at DESC";
    }
    
    const limit = criteria?.limit || 50;
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    
    const offset = criteria?.offset || 0;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    return this.query(query, params);
  },

  async getLatestGuard(criteria: any, user?: any, placeholder?: any) {
    return this.getLatestOverlook(criteria, user);
  },

  async getLatestPaywall(criteria: any, user?: any) {
    return this.getLatestOverlook(criteria, user);
  },

  async getHeaders(id: number) {
    return null;
  },

  async getCountOverlook(criteria: any, user?: any) {
    const row = await queryFirstRow("SELECT COUNT(*) as count FROM Messages", []);
    return { count: row ? parseInt(row.count) : 0 };
  },

  async getCountGuard(criteria: any, user?: any) {
    return this.getCountOverlook(criteria, user);
  },

  async getCountPaywall(criteria: any, user?: any) {
    return this.getCountOverlook(criteria, user);
  },

  async create(authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const { message_list_id, body, reply_target_id } = payload;
    
    const row = await queryFirstRow(
      `INSERT INTO Messages (message_list_id, reply_target_id, author_id, body)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [message_list_id, reply_target_id || null, authorId, body]
    );
    const defaultComp = await getDefaultMessageComponent();
    return compileMessagesToContent([row], defaultComp);
  },

  async update(id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const row = await queryFirstRow(
      `UPDATE Messages SET body = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [payload.body, id],
      "Message not found"
    );
    if (row && !('error' in row)) {
      const defaultComp = await getDefaultMessageComponent();
      return compileMessagesToContent([row], defaultComp);
    }
    return row;
  },

  async delete(id: number) {
    const result = await pool.query("DELETE FROM Messages WHERE id = $1 RETURNING *", [id]);
    if (result.rowCount === 0) {
      return { error: "Message not found", status: 404 };
    }
    return result.rows[0];
  },

  async stage() { return { error: "Not supported", status: 400 }; },
  async addUser() { return { error: "Not supported", status: 400 }; },
  async removeUser() {},
  async getUsers() { return []; },
  async addGroup() { return { error: "Not supported", status: 400 }; },
  async removeGroup() {},
  async getGroups() { return []; }
};
