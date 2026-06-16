import type { IPreemptEvent } from "../../../src/types/Event.js";
import { PreemptEvent } from "../../../src/types/Event.js";
import { pool } from '../db.js';
import { queryFirstRow, logEvent, fireAndForgetEvent } from '../utils/db.js';
import type { IContentSource, IContentData } from '../models/interfaces.js';
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultMessageList: any = null;
let cachedDefaultMessageListTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function getDefaultMessageListComponent() {
  const now = Date.now();
  if (!cachedDefaultMessageList || now - cachedDefaultMessageListTimestamp > CACHE_TTL_MS) {
    cachedDefaultMessageList = await pgSettingSource.get(new PreemptEvent('settings.get', { id: 'system', type: 'process' }), 'default-message-list');
    cachedDefaultMessageListTimestamp = now;
    
    if (!cachedDefaultMessageList) {
      cachedDefaultMessageList = {
        type: 'div',
        css: { classes: ['message-list'] },
        content: [
          { type: 'h3', component: [{ reference: 'listName', target: 'content' }] },
          { type: 'strong', component: [{ reference: 'recentMessageAuthor', target: 'content' }] },
          { type: 'span', component: [{ reference: 'recentMessageDate', target: 'content' }] },
          { type: 'p', component: [{ reference: 'recentMessageBody', target: 'content' }] }
        ]
      };
    }
  }
  return cachedDefaultMessageList;
}

function compileMessageListsToContent(listRows: any[], defaultComp: any): IContentData {
  let minCreatedAt = Date.now();
  let maxUpdatedAt = 0;

  if (listRows.length > 0) {
    if (listRows[0].recent_message && listRows[0].recent_message.created_at) {
        minCreatedAt = new Date(listRows[0].recent_message.created_at).getTime();
        maxUpdatedAt = new Date(listRows[0].recent_message.updated_at).getTime();
    }
  }

  const payload = listRows.map(listRow => {
    let recentMessageDate = '';
    let recentMessageAuthor = '';
    let recentMessageBody = '';

    if (listRow.recent_message) {
      const rm = listRow.recent_message;
      const cTime = new Date(rm.created_at).getTime();
      const uTime = new Date(rm.updated_at).getTime();
      if (cTime < minCreatedAt) minCreatedAt = cTime;
      if (uTime > maxUpdatedAt) maxUpdatedAt = uTime;
      
      recentMessageDate = new Date(rm.created_at).toISOString();
      recentMessageAuthor = rm.author_id;
      recentMessageBody = rm.body;
    }

    return {
      ...defaultComp,
      component: [
        { reference: 'listId', value: listRow.id },
        { reference: 'listName', value: listRow.name },
        { reference: 'groupId', value: listRow.group_id },
        { reference: 'recentMessageAuthor', value: recentMessageAuthor },
        { reference: 'recentMessageDate', value: recentMessageDate },
        { reference: 'recentMessageBody', value: recentMessageBody }
      ]
    };
  });

  return {
    id: 0,
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

export async function getMessageListGroup(event: IPreemptEvent, listId: number) {
  const row = await queryFirstRow("SELECT group_id FROM MessageLists WHERE id = $1", [listId]);
  fireAndForgetEvent(event);
  return row ? row.group_id : null;
}

export async function createMessageList(event: IPreemptEvent, groupId: number, name?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "INSERT INTO MessageLists (name, group_id) VALUES ($1, $2) RETURNING *",
      [name || null, groupId]
    );
    await logEvent(client, event);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const pgMessageListSource: IContentSource = {
  async getSubjectContext(event: IPreemptEvent, listId: number) {
    fireAndForgetEvent(event);
    return null;
  },

  async get(event: IPreemptEvent, criteria: any, user?: any, placeholder?: any) {
    if (criteria.count_only) {
      fireAndForgetEvent(event);
      return { count: 0 };
    }

    if (criteria.id !== undefined) {
      const query = `
        SELECT ml.id, ml.name, ml.group_id,
          (SELECT row_to_json(m) FROM Messages m WHERE m.message_list_id = ml.id ORDER BY m.created_at DESC LIMIT 1) as recent_message
        FROM MessageLists ml
        WHERE ml.id = $1
      `;
      const row = await queryFirstRow(query, [criteria.id], "Message list not found");
      fireAndForgetEvent(event);
      if (row && !('error' in row)) {
        const defaultComp = await getDefaultMessageListComponent();
        return compileMessageListsToContent([row], defaultComp);
      }
      return row;
    }

    let username = user ? user.username : null;
    let limit = 50;
    let offset = 0;

    if (criteria) {
      if (criteria.list_id) username = criteria.list_id;
      if (criteria.limit) limit = criteria.limit;
      if (criteria.offset) offset = criteria.offset;
    }

    if (!username) {
      fireAndForgetEvent(event);
      return [];
    }

    const query = `
      SELECT ml.id, ml.name, ml.group_id,
        (SELECT row_to_json(m) FROM Messages m WHERE m.message_list_id = ml.id ORDER BY m.created_at DESC LIMIT 1) as recent_message
      FROM MessageLists ml
      JOIN UserGroupMembers ugm ON ml.group_id = ugm.group_id
      WHERE ugm.username = $1
      ORDER BY (SELECT created_at FROM Messages m WHERE m.message_list_id = ml.id ORDER BY m.created_at DESC LIMIT 1) DESC NULLS LAST, ml.id DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [username, limit, offset]);
    const defaultComp = await getDefaultMessageListComponent();
    fireAndForgetEvent(event);
    return [compileMessageListsToContent(result.rows, defaultComp)];
  },

  async query(event: IPreemptEvent, query: string, params: any[]) {
    const result = await pool.query(query, params);
    const defaultComp = await getDefaultMessageListComponent();
    fireAndForgetEvent(event);
    return [compileMessageListsToContent(result.rows, defaultComp)];
  },

  async getHeaders(event: IPreemptEvent, id: number) { fireAndForgetEvent(event); return null; },
  async create(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async update(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async delete(event: IPreemptEvent, id: number) { return { error: "Not supported", status: 400 }; },
  async stage(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async addUser(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async removeUser(event: IPreemptEvent) {},
  async getUsers(event: IPreemptEvent) { return []; },
  async addGroup(event: IPreemptEvent) { return { error: "Not supported", status: 400 }; },
  async removeGroup(event: IPreemptEvent) {},
  async getGroups(event: IPreemptEvent) { return []; }
};
