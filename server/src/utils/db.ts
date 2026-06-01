import { pool } from "../db.js";

export async function queryFirstRow(query: string, params: any[] = []): Promise<any> {
  const result = await pool.query(query, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}
