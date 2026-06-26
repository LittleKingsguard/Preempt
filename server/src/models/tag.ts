import { logger } from "../utils/logger.js";
import { PreemptEvent } from "../../../src/types/Event.js";
import { pgTagSource } from "../sources/tagSource.js";
import type { ITagSource } from "./interfaces.js";

export class Tag {
  static tagCache: Set<string> = new Set();
  static CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

  static async initCache(source: ITagSource = pgTagSource) {
    await this.refreshCache(source);
    // Periodically refresh cache
    setInterval(() => {
      this.refreshCache(source).catch(err => logger.error({ err: err }, "Failed to refresh tag cache"));
    }, this.CACHE_TTL_MS);
  }

  static async refreshCache(source: ITagSource = pgTagSource) {
    try {
      const tags = await source.fetchAll(new PreemptEvent<any>('tag.fetchAll', { id: 'system', type: 'process' }));
      this.tagCache = new Set(tags);
    } catch (err) {
      logger.error({ err: err }, "Failed to fetch tags for cache");
    }
  }

  static async getTags(source: ITagSource = pgTagSource, criteria?: { format?: 'raw' | 'content' }) {
    if (criteria?.format === 'content') {
      return await source.fetchAll(new PreemptEvent<any>('tag.fetchAll', { id: 'system', type: 'process' }), criteria);
    }
    return Array.from(this.tagCache);
  }

  static addTagsToCache(tags: string[]) {
    if (tags) {
      tags.forEach(t => this.tagCache.add(t));
    }
  }

}
