import type { IPreemptEvent } from "../../../src/types/Event.js";
import { PreemptEvent } from "../../../src/types/Event.js";
import { pool } from '../db.js';
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from '../utils/db.js';
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
    
    const idRes = await pool.query("SELECT nextval('messages_id_seq')");
    const newId = parseInt(idRes.rows[0].nextval, 10);
    const now = new Date();
    
    const row = {
      id: newId,
      message_list_id,
      reply_target_id: reply_target_id || null,
      author_id: authorId,
      body,
      created_at: now,
      updated_at: now
    };

    const defaultComp = await getDefaultMessageComponent();
    const compiled = compileMessagesToContent([row], defaultComp);

    event.interestedParties = [`messageList:${message_list_id}`];
    event.stateChange = { before: null, after: compiled };
    const cte = getLogEventCTE(event, 8);

    await pool.query(
      `WITH inserted AS (
         INSERT INTO Messages (id, message_list_id, reply_target_id, author_id, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
       ),
       ${cte.sql}
       SELECT 1`,
      [newId, message_list_id, row.reply_target_id, authorId, body, now, now, ...cte.params]
    );

    return compiled;
  },

  async update(event: IPreemptEvent, id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const existing = await queryFirstRow("SELECT * FROM Messages WHERE id = $1", [id]);
    if (!existing) return { error: "Message not found", status: 404 };

    const now = new Date();
    const row = {
      ...existing,
      body: payload.body,
      updated_at: now
    };

    const defaultComp = await getDefaultMessageComponent();
    const compiled = compileMessagesToContent([row], defaultComp);

    event.interestedParties = [`messageList:${row.message_list_id}`];
    event.stateChange = { before: null, after: compiled };
    const cte = getLogEventCTE(event, 4);

    const result = await pool.query(
      `WITH updated AS (
         UPDATE Messages SET body = $1, updated_at = $2 WHERE id = $3 RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM updated`,
      [payload.body, now, id, ...cte.params]
    );

    if (result.rows.length === 0) {
      return { error: "Message not found", status: 404 };
    }

    return compiled;
  },

  async delete(event: IPreemptEvent, id: number) {
    const existing = await queryFirstRow("SELECT * FROM Messages WHERE id = $1", [id]);
    if (!existing) return { error: "Message not found", status: 404 };

    event.interestedParties = [`messageList:${existing.message_list_id}`];
    event.stateChange = { before: existing, after: null };
    const cte = getLogEventCTE(event, 2);

    const result = await pool.query(
      `WITH deleted AS (
         DELETE FROM Messages WHERE id = $1 RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM deleted`,
      [id, ...cte.params]
    );

    if (result.rowCount === 0) {
      return { error: "Message not found", status: 404 };
    }

    return result.rows[0];
  },

  async stage(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async addUser(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async removeUser(event: IPreemptEvent) {},
  async getUsers(event: IPreemptEvent) { return []; },
  async addGroup(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async removeGroup(event: IPreemptEvent) {},
  async getGroups(event: IPreemptEvent) { return []; }
};
