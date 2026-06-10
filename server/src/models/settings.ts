import { pgSettingSource } from "../sources/settingsSource.js";
import type { ISettingSource } from "./interfaces.js";

interface CacheEntry {
  value: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1 minute cache

export class Setting {
  static async get(source: ISettingSource = pgSettingSource, key: string): Promise<any> {
    const now = Date.now();
    const cached = cache.get(key);
    
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      return cached.value;
    }

    const row = await source.get(key);
    const value = row ? row.value : null;
    
    cache.set(key, { value, timestamp: now });
    return value;
  }

  static async set(source: ISettingSource = pgSettingSource, key: string, value: any): Promise<void | { error: string, status: number }> {
    let stringified: string;
    try {
      stringified = JSON.stringify(value); // This will throw on circular references
    } catch (err: any) {
      return { error: "Cannot serialize circular reference", status: 400 };
    }
    await source.set(key, stringified);
    
    cache.set(key, { value, timestamp: Date.now() });
  }
}
