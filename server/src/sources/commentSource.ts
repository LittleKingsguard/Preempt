import { PreemptEvent, type IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from '../db.js';
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from '../utils/db.js';
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
    
    // Pre-generate ID and dates to construct the JSON state change without a transaction
    const idRes = await pool.query("SELECT nextval('comments_id_seq')");
    const newId = parseInt(idRes.rows[0].nextval, 10);
    const now = new Date();
    
    const row = {
      id: newId,
      comment_list_id,
      parent_comment_id: parent_comment_id || null,
      target_placement: target_placement || null,
      author_id: authorId,
      body,
      created_at: now,
      updated_at: now
    };

    const defaultComp = await getDefaultCommentComponent(event);
    const compiled = compileCommentsToContent([row], defaultComp);

    event.interestedParties = [`commentList:${comment_list_id}`];
    event.stateChange = { before: null, after: compiled };
    const cte = getLogEventCTE(event, 9);

    await pool.query(
      `WITH inserted AS (
         INSERT INTO Comments (id, comment_list_id, parent_comment_id, target_placement, author_id, body, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
       ),
       ${cte.sql}
       SELECT 1`,
      [newId, comment_list_id, row.parent_comment_id, row.target_placement, authorId, body, now, now, ...cte.params]
    );

    return compiled;
  },

  async update(event: IPreemptEvent, id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const existing = await queryFirstRow("SELECT * FROM Comments WHERE id = $1", [id]);
    if (!existing) return { error: "Comment not found", status: 404 };

    const now = new Date();
    const row = {
      ...existing,
      body: payload.body,
      updated_at: now
    };

    const defaultComp = await getDefaultCommentComponent(event);
    const compiled = compileCommentsToContent([row], defaultComp);

    event.interestedParties = [`commentList:${row.comment_list_id}`];
    event.stateChange = { before: null, after: compiled };
    const cte = getLogEventCTE(event, 4);

    const result = await pool.query(
      `WITH updated AS (
         UPDATE Comments SET body = $1, updated_at = $2 WHERE id = $3 RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM updated`,
      [payload.body, now, id, ...cte.params]
    );

    if (result.rows.length === 0) {
      return { error: "Comment not found", status: 404 };
    }

    return compiled;
  },

  async delete(event: IPreemptEvent, id: number) {
    const existing = await queryFirstRow("SELECT * FROM Comments WHERE id = $1", [id]);
    if (!existing) return { error: "Comment not found", status: 404 };

    event.interestedParties = [`commentList:${existing.comment_list_id}`];
    event.stateChange = { before: existing, after: null };
    const cte = getLogEventCTE(event, 2);

    const result = await pool.query(
      `WITH deleted AS (
         DELETE FROM Comments WHERE id = $1 RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM deleted`,
      [id, ...cte.params]
    );

    if (result.rowCount === 0) {
      return { error: "Comment not found", status: 404 };
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
