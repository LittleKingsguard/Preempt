import { PreemptEvent } from "../../../src/types/Event.js";
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
    const row = await source.create(new PreemptEvent<any>('changeBatches.create', { id: 'system', type: 'process' }, [], { before: null, after: { authorId, description } }), authorId, description);
    if (!row) return null; // Create shouldn't realistically fail with 0 rows, but we keep it safe
    if ('error' in row) return row;
    return new ChangeBatch(row, source);
  }

  static async getById(source: IChangeBatchSource = pgChangeBatchSource, id: number) {
    const row = await source.getById(new PreemptEvent<any>('changeBatches.getById', { id: 'system', type: 'process' }, [], { before: null, after: { id } }), id);
    if ('error' in row) return row;
    return new ChangeBatch(row, source);
  }

  static async getPending(source: IChangeBatchSource = pgChangeBatchSource) {
    const rows = await source.getPending(new PreemptEvent<any>('changeBatches.getPending', { id: 'system', type: 'process' }));
    return rows.map(r => new ChangeBatch(r, source));
  }

  static async markMerged(source: IChangeBatchSource = pgChangeBatchSource, id: number) {
    const row = await source.markMerged(new PreemptEvent<any>('changeBatches.markMerged', { id: 'system', type: 'process' }, [], { before: null, after: { id } }), id);
    if ('error' in row) return row;
    return new ChangeBatch(row, source);
  }

  async delete() {
    await this.source.delete(new PreemptEvent<any>('changeBatches.delete', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { id: this.id } }), this.id);
  }

  async approve() {
    await this.source.approve(new PreemptEvent<any>('changeBatches.approve', { id: 'system', type: 'process' }, [], { before: { ...this, source: undefined }, after: { id: this.id } }), this.id);
  }
}
