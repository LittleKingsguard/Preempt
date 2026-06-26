import { PreemptEvent } from "../../../src/types/Event.js";
import { pgSettingSource } from "../sources/settingsSource.js";
import type { ISettingSource } from "./interfaces.js";

interface CacheEntry {
  value: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute cache

export function clearCache() {
  cache.clear();
}

export class Setting {
  static async get(source: ISettingSource = pgSettingSource, key: string, criteria?: { format?: 'raw' | 'content' }): Promise<any> {
    const format = criteria?.format || 'raw';
    const cacheKey = `get:${key}:${format}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      return cached.value;
    }

    const result = await source.get(new PreemptEvent<any>('settings.get', { id: 'system', type: 'process' }, [], { before: null, after: { key } }), key, criteria);
    
    // If format is content, result is an IContentData object. If raw, result might be a string (updated source logic) or undefined.
    // Wait, in my updated source, if format='raw', it returns row ? row.value : null.
    // So `result` is already the value or the content payload.
    const value = result;
    
    cache.set(cacheKey, { value, timestamp: now });
    return value;
  }

  static async getAll(source: ISettingSource = pgSettingSource, criteria?: { format?: 'raw' | 'content' }): Promise<any> {
    const format = criteria?.format || 'raw';
    const cacheKey = `getAll:${format}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      return cached.value;
    }

    const result = await source.getAll!(new PreemptEvent<any>('settings.getAll', { id: 'system', type: 'process' }), criteria);
    
    cache.set(cacheKey, { value: result, timestamp: now });
    return result;
  }

  static async set(source: ISettingSource = pgSettingSource, key: string, value: any): Promise<void | { error: string, status: number }> {
    let stringified: string;
    try {
      stringified = JSON.stringify(value); // This will throw on circular references
    } catch (err: any) {
      return { error: "Cannot serialize circular reference", status: 400 };
    }
    await source.set(new PreemptEvent<any>('settings.set', { id: 'system', type: 'process' }, [], { before: null, after: { key, value } }), key, stringified);
    
    cache.set(key, { value, timestamp: Date.now() });
  }
}
