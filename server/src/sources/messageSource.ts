import type { IPreemptEvent } from "../../../src/types/Event.js";
import { PreemptEvent } from "../../../src/types/Event.js";
import { pool } from '../db.js';
import { queryFirstRow, logEvent, fireAndForgetEvent } from '../utils/db.js';
import type { IContentSource, IContentData } from '../models/interfaces.js';
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultMessage: any = null;
let cachedDefaultMessageTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function getDefaultMessageComponent() {
  const now = Date.now();
  if (!cachedDefaultMessage || now - cachedDefaultMessageTimestamp > CACHE_TTL_MS) {
    cachedDefaultMessage = await pgSettingSource.get(new PreemptEvent('settings.get', { id: 'system', type: 'process' }), 'default-message');
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

export async function getMessageAuthor(event: IPreemptEvent, messageId: number) {
  const row = await queryFirstRow("SELECT author_id FROM Messages WHERE id = $1", [messageId]);
  fireAndForgetEvent(event);
  return row ? row.author_id : null;
}

export const pgMessageSource: IContentSource = {
  async get(event: IPreemptEvent, criteria: any, user?: any, placeholder?: any) {
    if (criteria.count_only) {
      const row = await queryFirstRow("SELECT COUNT(*) as count FROM Messages", []);
      fireAndForgetEvent(event);
      return { count: row ? parseInt(row.count) : 0 };
    }

    if (criteria.id !== undefined) {
      const row = await queryFirstRow("SELECT * FROM Messages WHERE id = $1", [criteria.id], "Message not found");
      fireAndForgetEvent(event);
      if (row && !('error' in row)) {
        const defaultComp = await getDefaultMessageComponent();
        return compileMessagesToContent([row], defaultComp);
      }
      return row;
    }

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

    const res = await this.query(event, query, params);
    fireAndForgetEvent(event);
    return res;
  },

  async query(event: IPreemptEvent, query: string, params: any[]) {
    const result = await pool.query(query, params);
    const defaultComp = await getDefaultMessageComponent();
    fireAndForgetEvent(event);
    return [compileMessagesToContent(result.rows, defaultComp)];
  },

  async getHeaders(event: IPreemptEvent, id: number) {
    fireAndForgetEvent(event);
    return null;
  },

  async create(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const { message_list_id, body, reply_target_id } = payload;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO Messages (message_list_id, reply_target_id, author_id, body)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [message_list_id, reply_target_id || null, authorId, body]
      );
      const row = result.rows[0];
      await logEvent(client, event);
      await client.query('COMMIT');
      
      const defaultComp = await getDefaultMessageComponent();
      return compileMessagesToContent([row], defaultComp);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(event: IPreemptEvent, id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE Messages SET body = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [payload.body, id]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: "Message not found", status: 404 };
      }
      const row = result.rows[0];
      await logEvent(client, event);
      await client.query('COMMIT');
      
      const defaultComp = await getDefaultMessageComponent();
      return compileMessagesToContent([row], defaultComp);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(event: IPreemptEvent, id: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("DELETE FROM Messages WHERE id = $1 RETURNING *", [id]);
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return { error: "Message not found", status: 404 };
      }
      await logEvent(client, event);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async stage(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async addUser(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async removeUser(event: IPreemptEvent) {},
  async getUsers(event: IPreemptEvent) { return []; },
  async addGroup(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async removeGroup(event: IPreemptEvent) {},
  async getGroups(event: IPreemptEvent) { return []; }
};
