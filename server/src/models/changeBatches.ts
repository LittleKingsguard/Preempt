import { pgChangeBatchSource } from "../sources/changeBatchSource.js";
import type { IChangeBatchData, IChangeBatchSource } from "./interfaces.js";

export class ChangeBatch {
  source: IChangeBatchSource;
  id: number;
  author_id: string;
  description: string;
  merged_at: Date | null;
  created_at: Date;

  constructor(data: IChangeBatchData, source: IChangeBatchSource = pgChangeBatchSource) {
    this.source = source;
    this.id = data.id;
    this.author_id = data.author_id;
    this.description = data.description;
    this.merged_at = data.merged_at || null;
    this.created_at = data.created_at || new Date();
  }

  static async create(source: IChangeBatchSource = pgChangeBatchSource, authorId: string, description: string) {
    const row = await source.create(authorId, description);
    if (!row) return null; // Create shouldn't realistically fail with 0 rows, but we keep it safe
    if ('error' in row) return row;
    return new ChangeBatch(row, source);
  }

  static async getById(source: IChangeBatchSource = pgChangeBatchSource, id: number) {
    const row = await source.getById(id);
    if ('error' in row) return row;
    return new ChangeBatch(row, source);
  }

  static async getPending(source: IChangeBatchSource = pgChangeBatchSource) {
    const rows = await source.getPending();
    return rows.map(r => new ChangeBatch(r, source));
  }

  static async markMerged(source: IChangeBatchSource = pgChangeBatchSource, id: number) {
    const row = await source.markMerged(id);
    if ('error' in row) return row;
    return new ChangeBatch(row, source);
  }

  async delete() {
    await this.source.delete(this.id);
  }

  async approve() {
    await this.source.approve(this.id);
  }
}
