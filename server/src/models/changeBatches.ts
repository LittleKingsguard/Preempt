import * as changeBatchSource from "../sources/changeBatchSource.js";

export class ChangeBatch {
  id: number;
  author_id: string;
  description: string;
  merged_at: Date | null;
  created_at: Date;

  constructor(data: any) {
    this.id = data.id;
    this.author_id = data.author_id;
    this.description = data.description;
    this.merged_at = data.merged_at;
    this.created_at = data.created_at;
  }

  static async create(authorId: string, description: string) {
    const row = await changeBatchSource.dbCreateChangeBatch(authorId, description);
    if (!row) return null; // Create shouldn't realistically fail with 0 rows, but we keep it safe
    if ('error' in row) return row;
    return new ChangeBatch(row);
  }

  static async getById(id: number) {
    const row = await changeBatchSource.dbGetChangeBatchById(id);
    if ('error' in row) return row;
    return new ChangeBatch(row);
  }

  static async getPending() {
    const rows = await changeBatchSource.dbGetPendingChangeBatches();
    return rows.map(r => new ChangeBatch(r));
  }

  static async markMerged(id: number) {
    const row = await changeBatchSource.dbMarkChangeBatchMerged(id);
    if ('error' in row) return row;
    return new ChangeBatch(row);
  }

  async delete() {
    await changeBatchSource.dbDeleteChangeBatch(this.id);
  }

  async approve() {
    await changeBatchSource.dbApproveChangeBatch(this.id);
  }
}
