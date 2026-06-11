import { pgTagSource } from "../sources/tagSource.js";
import type { ITagSource } from "./interfaces.js";

export class Tag {
  static tagCache: Set<string> = new Set();
  static CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

  static async initCache(source: ITagSource = pgTagSource) {
    await this.refreshCache(source);
    // Periodically refresh cache
    setInterval(() => {
      this.refreshCache(source).catch(err => console.error("Failed to refresh tag cache", err));
    }, this.CACHE_TTL_MS);
  }

  static async refreshCache(source: ITagSource = pgTagSource) {
    try {
      const tags = await source.fetchAll();
      this.tagCache = new Set(tags);
    } catch (err) {
      console.error("Failed to fetch tags for cache", err);
    }
  }

  static getTags() {
    return Array.from(this.tagCache);
  }

  static addTagsToCache(tags: string[]) {
    if (tags) {
      tags.forEach(t => this.tagCache.add(t));
    }
  }

}
