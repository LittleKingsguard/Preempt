import type { IPreemptEvent } from "../../../src/types/Event.js";
import { fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import { pool } from "../db.js";

export async function dbFetchAllTags(event: IPreemptEvent): Promise<string[]> {
  const result = await pool.query("SELECT name FROM Tags");
  fireAndForgetEvent(event);
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
      SELECT ${contentIdRef}, id FROM Tags WHERE name = ANY($${tagsParamIdx}::text[])
    )
  `;
}



import type { ITagSource } from "../models/interfaces.js";
export const pgTagSource: ITagSource = {
  fetchAll: dbFetchAllTags,
  updateTemplateTags: dbUpdateTemplateTags,
  updateContentTags: dbUpdateContentTags
};
