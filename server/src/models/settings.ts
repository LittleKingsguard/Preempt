import * as settingsSource from "../sources/settingsSource.js";

interface CacheEntry {
  value: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute cache

export class Setting {
  static async get(key: string): Promise<any> {
    const now = Date.now();
    const cached = cache.get(key);
    
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      return cached.value;
    }

    const row = await settingsSource.dbGetSetting(key);
    const value = row ? row.value : null;
    
    cache.set(key, { value, timestamp: now });
    return value;
  }

  static async set(key: string, value: any): Promise<void> {
    const stringified = JSON.stringify(value); // This will throw on circular references
    await settingsSource.dbSetSetting(key, stringified);
    
    cache.set(key, { value, timestamp: Date.now() });
  }
}
