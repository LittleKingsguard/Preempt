import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";

import type { IContentData } from '../models/interfaces.js';

let cachedDefaultSetting: any = null;
let cachedDefaultSettingTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

async function getDefaultSettingComponent(event: IPreemptEvent) {
  const now = Date.now();
  if (!cachedDefaultSetting || now - cachedDefaultSettingTimestamp > CACHE_TTL_MS) {
    const row = await queryFirstRow("SELECT value FROM SiteSettings WHERE key = $1", ['default-setting']);
    cachedDefaultSetting = row ? JSON.parse(row.value) : null;
    cachedDefaultSettingTimestamp = now;
    
    if (!cachedDefaultSetting) {
      cachedDefaultSetting = {
        type: 'div',
        css: { classes: ['setting-item'] },
        content: [
          { type: 'strong', component: [{ reference: 'settingKey', target: 'content' }] },
          { type: 'span', content: ': ' },
          { type: 'span', component: [{ reference: 'settingValue', target: 'content' }] }
        ]
      };
    }
  }
  return cachedDefaultSetting;
}

function compileSettingsToContent(settingRows: any[], defaultSettingComp: any): IContentData {
  const payload = settingRows.map(row => {
    let displayValue = row.value;
    if (typeof displayValue === 'object' && displayValue !== null) {
      displayValue = JSON.stringify(displayValue);
    }
    return {
      ...defaultSettingComp,
      placement: [{ targetPlacement: [`setting-${row.key}`, "settings"] }],
      component: [
        { reference: 'settingKey', value: row.key },
        { reference: 'settingValue', value: displayValue }
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

export async function dbGetSetting(event: IPreemptEvent, key: string, criteria?: { format?: 'raw' | 'content' }) {
  const row = await queryFirstRow("SELECT key, value FROM SiteSettings WHERE key = $1", [key]);
  fireAndForgetEvent(event);
  
  if (row && criteria?.format === 'content') {
    const defaultComp = await getDefaultSettingComponent(event);
    return compileSettingsToContent([row], defaultComp);
  }
  
  return row ? row.value : null; // Existing implementation returned just value
}

export async function dbGetAllSettings(event: IPreemptEvent, criteria?: { format?: 'raw' | 'content' }) {
  const result = await pool.query("SELECT key, value FROM SiteSettings");
  fireAndForgetEvent(event);
  
  if (criteria?.format === 'content') {
    const defaultComp = await getDefaultSettingComponent(event);
    return compileSettingsToContent(result.rows, defaultComp);
  }
  
  const obj: any = {};
  for (const row of result.rows) {
    obj[row.key] = row.value;
  }
  return obj;
}

export async function dbSetSetting(event: IPreemptEvent, key: string, valueStr: string) {
  const cte = getLogEventCTE(event, 3);
  await pool.query(
    `WITH inserted AS (
       INSERT INTO SiteSettings (key, value, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
     ),
     ${cte.sql}
     SELECT 1`,
    [key, valueStr, ...cte.params]
  );
}

import type { ISettingSource } from "../models/interfaces.js";
export const pgSettingSource: ISettingSource = {
  get: dbGetSetting,
  getAll: dbGetAllSettings,
  set: dbSetSetting
};
