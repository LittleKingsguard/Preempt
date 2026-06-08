import * as tagSource from "../sources/tagSource.js";

export class Tag {
  static tagCache: Set<string> = new Set();
  static CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

  static async initCache() {
    await this.refreshCache();
    // Periodically refresh cache
    setInterval(() => {
      this.refreshCache().catch(err => console.error("Failed to refresh tag cache", err));
    }, this.CACHE_TTL_MS);
  }

  static async refreshCache() {
    try {
      const tags = await tagSource.dbFetchAllTags();
      this.tagCache = new Set(tags);
    } catch (err) {
      console.error("Failed to fetch tags for cache", err);
    }
  }

  static getTags() {
    return Array.from(this.tagCache);
  }

  static async updateTemplateTags(client: any, templateId: number, tags: string[]) {
    await tagSource.dbUpdateTemplateTags(client, templateId, tags);
    if (tags) {
      tags.forEach(t => this.tagCache.add(t));
    }
  }

  static async updateContentTags(client: any, contentId: number, tags: string[]) {
    await tagSource.dbUpdateContentTags(client, contentId, tags);
    if (tags) {
      tags.forEach(t => this.tagCache.add(t));
    }
  }

  static async updateContentTemplateGroups(client: any, contentId: number, groupIds: number[]) {
    return await tagSource.dbUpdateContentTemplateGroups(client, contentId, groupIds);
  }
}
