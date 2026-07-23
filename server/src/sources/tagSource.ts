import type { IPreemptEvent } from "../../../src/types/Event.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import { pgSettingSource } from './settingsSource.js';
import type { IContentData } from '../models/interfaces.js';
import { pool } from "../db.js";

let cachedDefaultTag: any = null;
let cachedDefaultTagTimestamp: number = 0;
const CACHE_TTL_MS = 60000;

async function getDefaultTagComponent(event: IPreemptEvent) {
  const now = Date.now();
  if (!cachedDefaultTag || now - cachedDefaultTagTimestamp > CACHE_TTL_MS) {
    const row = await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", ['default-tag']);
    cachedDefaultTag = row ? JSON.parse(row.value) : null;
    cachedDefaultTagTimestamp = now;
    
    if (!cachedDefaultTag) {
      cachedDefaultTag = {
        type: 'div',
        css: { classes: ['tag-item'] },
        content: [
          { type: 'span', component: [{ reference: 'tagName', target: 'content' }] }
        ]
      };
    }
  }
  return cachedDefaultTag;
}

function compileTagsToContent(tagRows: any[], defaultTagComp: any): IContentData {
  const payload = tagRows.map(row => {
    return {
      ...defaultTagComp,
      placement: [{ targetPlacement: [`tag-${row.name}`, "tags"] }],
      component: [
        { reference: 'tagName', value: row.name }
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

export async function dbFetchAllTags(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }) {
  const result = await pool.query("SELECT name FROM Tags");
  fireAndForgetEvent(event);
  
  if (criteria?.format === 'content') {
    const defaultComp = await getDefaultTagComponent(event);
    return compileTagsToContent(result.rows, defaultComp);
  }
  
  return result.rows.map((r: any) => r.name);
}

export async function dbUpdateTemplateTags(event: IPreemptEvent, client: any, templateId: number, tags: string[]) {
  const logCte = getLogEventCTE(event, 3);
  if (!tags || tags.length === 0) {
    await pool.query(`WITH deleted AS (DELETE FROM TemplateTags WHERE template_id = $1), ${logCte.sql} SELECT 1`, [templateId, null, ...logCte.params]);
    return;
  }
  
  await pool.query(`
    WITH ${buildUpdateTemplateTagsCTE('$1', 2)},
    ${logCte.sql}
    SELECT 1
  `, [templateId, tags, ...logCte.params]);
}

export function buildUpdateTemplateTagsCTE(templateIdRef: string, tagsParamIdx: number) {
  return `
    inserted_tags AS (
      INSERT INTO Tags (name) SELECT unnest($${tagsParamIdx}::text[]) ON CONFLICT DO NOTHING
    ),
    deleted_template_tags AS (
      DELETE FROM TemplateTags WHERE template_id = ${templateIdRef}
    ),
    inserted_template_tags AS (
      INSERT INTO TemplateTags (template_id, tag_id)
      SELECT ${templateIdRef}, id FROM Tags WHERE name = ANY($${tagsParamIdx}::text[])
    )
  `;
}

export async function dbUpdateContentTags(event: IPreemptEvent, client: any, contentId: number, tags: string[]) {
  const logCte = getLogEventCTE(event, 3);
  if (!tags || tags.length === 0) {
    await pool.query(`WITH deleted AS (DELETE FROM ContentTags WHERE content_id = $1), ${logCte.sql} SELECT 1`, [contentId, null, ...logCte.params]);
    return;
  }
  
  await pool.query(`
    WITH ${buildUpdateContentTagsCTE('$1', 2)},
    ${logCte.sql}
    SELECT 1
  `, [contentId, tags, ...logCte.params]);
}

export function buildUpdateContentTagsCTE(contentIdRef: string, tagsParamIdx: number) {
  return `
    inserted_tags AS (
      INSERT INTO Tags (name) SELECT unnest($${tagsParamIdx}::text[]) ON CONFLICT DO NOTHING
    ),
    deleted_content_tags AS (
      DELETE FROM ContentTags WHERE content_id = ${contentIdRef}
    ),
    inserted_content_tags AS (
      INSERT INTO ContentTags (content_id, tag_id)
      SELECT ${contentIdRef}, id FROM Tags WHERE name = ANY($${tagsParamIdx}::text[]) ON CONFLICT DO NOTHING
    )
  `;
}



import type { ITagSource } from "../models/interfaces.js";
export const pgTagSource: ITagSource = {
  fetchAll: dbFetchAllTags,
  updateTemplateTags: dbUpdateTemplateTags,
  updateContentTags: dbUpdateContentTags
};
