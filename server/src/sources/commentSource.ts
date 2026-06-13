import { pool } from '../db.js';
import { queryFirstRow } from '../utils/db.js';
import type { IContentSource, IContentData, IContentUserData, IContentUserGroupData } from '../models/interfaces.js';
import { pgSettingSource } from './settingsSource.js';

let cachedDefaultComment: any = null;
let cachedDefaultCommentTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function getDefaultCommentComponent() {
  const now = Date.now();
  if (!cachedDefaultComment || now - cachedDefaultCommentTimestamp > CACHE_TTL_MS) {
    cachedDefaultComment = await pgSettingSource.get('default-comment');
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

export async function getCommentAuthor(commentId: number) {
  const row = await queryFirstRow("SELECT author_id FROM Comments WHERE id = $1", [commentId]);
  return row ? row.author_id : null;
}

export const pgCommentSource: IContentSource = {
  async getSubjectContext(commentListId: number) {
    const list = await queryFirstRow("SELECT subject_type, subject_id FROM CommentLists WHERE id = $1", [commentListId]);
    if (!list || 'error' in list) return null;
    return list;
  },

  async get(criteria: any, user?: any, placeholder?: any) {
    if (criteria.count_only) {
      const row = await queryFirstRow("SELECT COUNT(*) as count FROM Comments", []);
      return { count: row ? parseInt(row.count) : 0 };
    }

    if (criteria.id !== undefined) {
      const row = await queryFirstRow("SELECT * FROM Comments WHERE id = $1", [criteria.id], "Comment not found");
      if (row && !('error' in row)) {
        const defaultComp = await getDefaultCommentComponent();
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

    return this.query(query, params);
  },

  async query(query: string, params: any[]) {
    const result = await pool.query(query, params);
    const defaultComp = await getDefaultCommentComponent();
    return [compileCommentsToContent(result.rows, defaultComp)];
  },

  async getHeaders(id: number) {
    return null;
  },

  async create(authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    // Expected payload to contain { comment_list_id, body, parent_comment_id, target_placement }
    const { comment_list_id, body, parent_comment_id, target_placement } = payload;
    
    const row = await queryFirstRow(
      `INSERT INTO Comments (comment_list_id, parent_comment_id, target_placement, author_id, body) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [comment_list_id, parent_comment_id || null, target_placement || null, authorId, body]
    );
    const defaultComp = await getDefaultCommentComponent();
    return compileCommentsToContent([row], defaultComp);
  },

  async update(id: number, authorId: string, payload: any, headers: string | null, isVisible: boolean, liveDate: Date | null, tags: string[], groupIds: number[], promo?: any) {
    const row = await queryFirstRow(
      `UPDATE Comments SET body = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [payload.body, id],
      "Comment not found"
    );
    if (row && !('error' in row)) {
      const defaultComp = await getDefaultCommentComponent();
      return compileCommentsToContent([row], defaultComp);
    }
    return row;
  },

  async delete(id: number) {
    const result = await pool.query("DELETE FROM Comments WHERE id = $1 RETURNING *", [id]);
    if (result.rowCount === 0) {
      return { error: "Comment not found", status: 404 };
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
