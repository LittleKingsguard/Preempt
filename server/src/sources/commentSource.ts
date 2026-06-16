import { PreemptEvent, type IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from '../db.js';
import { queryFirstRow, logEvent, fireAndForgetEvent } from '../utils/db.js';
import type { IContentSource, IContentData, IContentUserData, IContentUserGroupData } from '../models/interfaces.js';
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultComment: any = null;
let cachedDefaultCommentTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function getDefaultCommentComponent(event: IPreemptEvent) {
  const now = Date.now();
  if (!cachedDefaultComment || now - cachedDefaultCommentTimestamp > CACHE_TTL_MS) {
    cachedDefaultComment = await pgSettingSource.get(new PreemptEvent('comment.getSetting', { id: 'system', type: 'process' }), 'default-comment');
    cachedDefaultCommentTimestamp = now;
    
    if (!cachedDefaultComment) {
      cachedDefaultComment = {
        type: 'div',
        css: { classes: ['comment'] },
        content: [
          { type: 'strong', component: [{ reference: 'commentAuthor', target: 'content' }] },
          { type: 'span', component: [{ reference: 'commentDate', target: 'content' }] },
          { type: 'p', component: [{ reference: 'commentBody', target: 'content' }] }
        ]
      };
    }
  }
  return cachedDefaultComment;
}

function compileCommentsToContent(commentRows: any[], defaultCommentComp: any): IContentData {
  let minCreatedAt = Date.now();
  let maxUpdatedAt = 0;

  if (commentRows.length > 0) {
    minCreatedAt = new Date(commentRows[0].created_at).getTime();
    maxUpdatedAt = new Date(commentRows[0].updated_at).getTime();
  }

  const payload = commentRows.map(commentRow => {
    const cTime = new Date(commentRow.created_at).getTime();
    const uTime = new Date(commentRow.updated_at).getTime();
    if (cTime < minCreatedAt) minCreatedAt = cTime;
    if (uTime > maxUpdatedAt) maxUpdatedAt = uTime;

    let targetPlacement = [];
    if (commentRow.parent_comment_id) {
      targetPlacement.push(`comment-${commentRow.parent_comment_id}`);
    } else if (commentRow.target_placement) {
      targetPlacement.push(commentRow.target_placement);
    }

    return {
      ...defaultCommentComp,
      placement: targetPlacement.length > 0 ? { targetPlacement } : undefined,
      component: [
        { reference: 'commentAuthor', value: commentRow.author_id },
        { reference: 'commentDate', value: new Date(commentRow.created_at).toISOString() },
        { reference: 'commentBody', value: commentRow.body },
        { reference: 'commentId', value: commentRow.id }
      ]
    };
  });

  return {
    id: commentRows.length > 0 ? commentRows[0].comment_list_id : 0,
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

export async function getCommentAuthor(event: IPreemptEvent, commentId: number) {
  const row = await queryFirstRow("SELECT author_id FROM Comments WHERE id = $1", [commentId]);
  fireAndForgetEvent(event);
  return row ? row.author_id : null;
}

export const pgCommentSource: IContentSource = {
  async getSubjectContext(event: IPreemptEvent, commentListId: number) {
    const list = await queryFirstRow("SELECT subject_type, subject_id FROM CommentLists WHERE id = $1", [commentListId]);
    if (!list || 'error' in list) return null;
    fireAndForgetEvent(event);
    return list;
  },

  async get(event: IPreemptEvent, criteria: any, user?: any, placeholder?: any) {
    if (criteria.count_only) {
      const row = await queryFirstRow("SELECT COUNT(*) as count FROM Comments", []);
      fireAndForgetEvent(event);
      return { count: row ? parseInt(row.count) : 0 };
    }

    if (criteria.id !== undefined) {
      const row = await queryFirstRow("SELECT * FROM Comments WHERE id = $1", [criteria.id], "Comment not found");
      fireAndForgetEvent(event);
      if (row && !('error' in row)) {
        const defaultComp = await getDefaultCommentComponent(event);
        return compileCommentsToContent([row], defaultComp);
      }
      return row;
    }

    let query = "SELECT * FROM Comments";
    const params: any[] = [];
    if (criteria && criteria.list_id) {
      params.push(criteria.list_id);
      query += " WHERE comment_list_id = $1 ORDER BY created_at ASC";
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
    const defaultComp = await getDefaultCommentComponent(event);
    fireAndForgetEvent(event);
    return [compileCommentsToContent(result.rows, defaultComp)];
  },

  async getHeaders(event: IPreemptEvent, id: number) {
    fireAndForgetEvent(event);
    return null;
  },

  async create(event: IPreemptEvent, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    // Expected payload to contain { comment_list_id, body, parent_comment_id, target_placement }
    const { comment_list_id, body, parent_comment_id, target_placement } = payload;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO Comments (comment_list_id, parent_comment_id, target_placement, author_id, body) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [comment_list_id, parent_comment_id || null, target_placement || null, authorId, body]
      );
      const row = result.rows[0];
      await logEvent(client, event);
      await client.query('COMMIT');
      
      const defaultComp = await getDefaultCommentComponent(event);
      return compileCommentsToContent([row], defaultComp);
    } catch (err) {
      console.log('Error inside pgCommentSource.create:', err);
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
        `UPDATE Comments SET body = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [payload.body, id]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: "Comment not found", status: 404 };
      }
      const row = result.rows[0];
      await logEvent(client, event);
      await client.query('COMMIT');
      
      const defaultComp = await getDefaultCommentComponent(event);
      return compileCommentsToContent([row], defaultComp);
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
      const result = await client.query("DELETE FROM Comments WHERE id = $1 RETURNING *", [id]);
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return { error: "Comment not found", status: 404 };
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
