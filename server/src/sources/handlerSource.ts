import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";

import type { IHandlerSource, IContentData } from "../models/interfaces.js";
import { pgSettingSource } from './settingsSource.js';

interface CacheEntry {
  timestamp: number;
  value: any;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute

let cachedDefaultHandler: any = null;
let cachedDefaultHandlerTimestamp: number = 0;

async function getDefaultHandlerComponent(event: IPreemptEvent) {
  const now = Date.now();
  if (!cachedDefaultHandler || now - cachedDefaultHandlerTimestamp > CACHE_TTL) {
    const row = await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", ['default-handler']);
    cachedDefaultHandler = row ? JSON.parse(row.value) : null;
    cachedDefaultHandlerTimestamp = now;

    if (!cachedDefaultHandler) {
      cachedDefaultHandler = {
        type: 'div',
        css: { classes: ['handler-item'] },
        content: [
          { type: 'strong', component: [{ reference: 'handlerName', target: 'content' }] },
          { type: 'span', content: ' (Author: ' },
          { type: 'span', component: [{ reference: 'handlerAuthor', target: 'content' }] },
          { type: 'span', content: ')' },
          { type: 'pre', component: [{ reference: 'handlerBody', target: 'content' }] }
        ]
      };
    }
  }
  return cachedDefaultHandler;
}

function compileHandlersToContent(handlerRows: any[], defaultHandlerComp: any): IContentData {
  const payload = handlerRows.map(row => {
    return {
      ...defaultHandlerComp,
      placement: [{ targetPlacement: [`handler-${row.id}`, "handlers"] }],
      component: [
        { reference: 'handlerName', value: row.name },
        { reference: 'handlerAuthor', value: row.author_id },
        { reference: 'handlerBody', value: row.body }
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
    created_at: new Date(),
    updated_at: new Date()
  };
}

export async function dbGetHandlers(event: IPreemptEvent, criteria?: { templateId?: number; contentId?: number; componentIds?: number[]; format?: 'raw' | 'content'; name?: string }) {
  const cacheKey = criteria ? `getAll:${JSON.stringify(criteria)}` : 'getAll';
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }

  let query = "SELECT id, name, body, author_id, is_approved, approved_roles, created_at, updated_at FROM Handlers";
  const params: any[] = [];
  const orConditions: string[] = [];

  if (criteria?.templateId !== undefined) {
    params.push(criteria.templateId);
    orConditions.push(`EXISTS (SELECT 1 FROM TemplateHandlers th WHERE th.handler_id = Handlers.id AND th.template_id = $${params.length})`);
  }
  if (criteria?.contentId !== undefined) {
    params.push(criteria.contentId);
    orConditions.push(`EXISTS (SELECT 1 FROM ContentHandlers ch WHERE ch.handler_id = Handlers.id AND ch.content_id = $${params.length})`);
  }
  if (criteria?.componentIds !== undefined && criteria.componentIds.length > 0) {
    params.push(criteria.componentIds);
    orConditions.push(`EXISTS (SELECT 1 FROM ComponentHandlers cmh WHERE cmh.handler_id = Handlers.id AND cmh.component_id = ANY($${params.length}::int[]))`);
  }

  const whereConditions: string[] = [];
  if (orConditions.length > 0) {
    whereConditions.push("(" + orConditions.join(" OR ") + ")");
  }
  if (criteria?.name) {
    params.push(criteria.name);
    whereConditions.push(`name = $${params.length}`);
  }

  if (whereConditions.length > 0) {
    query += " WHERE " + whereConditions.join(" AND ");
  }

  const result = await pool.query(query, params);
  let finalResult = result.rows;

  if (criteria?.format === 'content') {
    const defaultComp = await getDefaultHandlerComponent(event);
    finalResult = compileHandlersToContent(result.rows, defaultComp) as any;
  }

  cache.set(cacheKey, { timestamp: Date.now(), value: finalResult });
  fireAndForgetEvent(event);
  return finalResult;
}

export async function dbGetHandlerById(event: IPreemptEvent, id: number, criteria?: { format?: 'raw' | 'content' }, client?: any) {
  const cacheKey = criteria?.format ? `getById:${id}:${criteria.format}` : `getById:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.value;
  }
  let result = await queryFirstRow("SELECT id, name, body, author_id, is_approved, approved_roles, created_at, updated_at FROM Handlers WHERE id = $1", [id], "Handler not found", client);
  if (result && !('error' in result)) {
    if (criteria?.format === 'content') {
      const defaultComp = await getDefaultHandlerComponent(event);
      result = compileHandlersToContent([result], defaultComp) as any;
    }
    cache.set(cacheKey, { timestamp: Date.now(), value: result });
  }
  fireAndForgetEvent(event);
  return result;
}

export async function dbCreateHandler(event: IPreemptEvent, name: string, body: string, authorId: string, isApproved: boolean) {
  const cte = getLogEventCTE(event, 5);
  try {
    const result = await pool.query(
      `WITH inserted AS (
         INSERT INTO Handlers (name, body, author_id, is_approved) VALUES ($1, $2, $3, $4) RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM inserted`,
      [name, body, authorId, isApproved, ...cte.params]
    );
    cache.clear();
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      return { error: "Handler with this name already exists", status: 409 };
    }
    throw err;
  }
}

export async function dbUpdateHandler(event: IPreemptEvent, id: number, name: string, body: string) {
  const cte = getLogEventCTE(event, 4);
  const result = await pool.query(
    `WITH updated AS (
       UPDATE Handlers SET name = $1, body = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *
     ),
     ${cte.sql}
     SELECT * FROM updated`,
    [name, body, id, ...cte.params]
  );
  if (result.rows.length === 0) {
    return { error: "Handler not found", status: 404 };
  }
  cache.clear();
  return result.rows[0];
}

export async function dbUpdateTemplateHandlers(event: IPreemptEvent, templateId: number, handlerNames: string[]) {
  const cte = getLogEventCTE(event, 3);
  if (!handlerNames || handlerNames.length === 0) {
    await pool.query(
      `WITH deleted AS (DELETE FROM TemplateHandlers WHERE template_id = $1),
       ${cte.sql}
       SELECT 1`,
      [templateId, null, ...cte.params]
    );
    cache.clear();
    return;
  }

  await pool.query(
    `WITH deleted AS (DELETE FROM TemplateHandlers WHERE template_id = $1),
     found_handlers AS (SELECT id FROM Handlers WHERE name = ANY($2::text[])),
     inserted AS (INSERT INTO TemplateHandlers (template_id, handler_id) SELECT $1, id FROM found_handlers),
     ${cte.sql}
     SELECT 1`,
    [templateId, handlerNames, ...cte.params]
  );
  cache.clear();
}

export async function dbUpdateContentHandlers(event: IPreemptEvent, contentId: number, handlerNames: string[]) {
  const cte = getLogEventCTE(event, 3);
  if (!handlerNames || handlerNames.length === 0) {
    await pool.query(
      `WITH deleted AS (DELETE FROM ContentHandlers WHERE content_id = $1),
       ${cte.sql}
       SELECT 1`,
      [contentId, null, ...cte.params]
    );
    cache.clear();
    return;
  }

  await pool.query(
    `WITH deleted AS (DELETE FROM ContentHandlers WHERE content_id = $1),
     found_handlers AS (SELECT id FROM Handlers WHERE name = ANY($2::text[])),
     inserted AS (INSERT INTO ContentHandlers (content_id, handler_id) SELECT $1, id FROM found_handlers),
     ${cte.sql}
     SELECT 1`,
    [contentId, handlerNames, ...cte.params]
  );
  cache.clear();
}

export async function dbStageHandler(event: IPreemptEvent, name: string, body: string, authorId: string, originalId: number | null, batchId: number) {
  const cte = getLogEventCTE(event, 7);
  let isStagedRow = false;

  if (originalId) {
    const existing = await pool.query(`
      SELECT h.change_batch_id 
      FROM Handlers h 
      JOIN ChangeBatches cb ON h.change_batch_id = cb.id 
      WHERE h.id = $1 AND cb.merged_at IS NULL
    `, [originalId]);
    isStagedRow = existing.rows.length > 0;
  }

  let result;
  if (isStagedRow) {
    result = await pool.query(
      `WITH updated AS (
         UPDATE Handlers SET name = $1, body = $2, change_batch_id = $3 WHERE id = $4 RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM updated`,
      [name, body, batchId, originalId, null, null, ...cte.params]
    );
  } else {
    result = await pool.query(
      `WITH inserted AS (
         INSERT INTO Handlers (name, body, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING *
       ),
       ${cte.sql}
       SELECT * FROM inserted`,
      [name, body, authorId, originalId, batchId, null, ...cte.params]
    );
  }

  cache.clear();
  return result.rows[0];
}

export async function dbDeleteHandler(event: IPreemptEvent, id: number) {
  const cte = getLogEventCTE(event, 2);
  const result = await pool.query(
    `WITH deleted AS (
       DELETE FROM Handlers WHERE id = $1 RETURNING *
     ),
     ${cte.sql}
     SELECT * FROM deleted`,
    [id, ...cte.params]
  );
  if (result.rows.length === 0) {
    return { error: "Handler not found", status: 404 };
  }
  cache.clear();
  return result.rows[0];
}

export async function dbApproveHandler(event: IPreemptEvent, id: number, is_approved: boolean) {
  const cte = getLogEventCTE(event, 3);
  const result = await pool.query(
    `WITH updated AS (
       UPDATE Handlers SET is_approved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *
     ),
     ${cte.sql}
     SELECT * FROM updated`,
    [is_approved, id, ...cte.params]
  );
  if (result.rows.length === 0) {
    return { error: "Handler not found", status: 404 };
  }
  cache.clear();
  return result.rows[0];
}
export const pgHandlerSource: IHandlerSource = {
  getAll: dbGetHandlers,
  getById: dbGetHandlerById,
  create: dbCreateHandler,
  update: dbUpdateHandler,
  delete: dbDeleteHandler,
  updateTemplateHandlers: dbUpdateTemplateHandlers,
  updateContentHandlers: dbUpdateContentHandlers,
  stage: dbStageHandler,
  approve: dbApproveHandler
};
