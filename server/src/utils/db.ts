import { pool } from "../db.js";

export async function queryFirstRow(query: string, params: any[] = [], errorMsg?: string): Promise<any> {
  const result = await pool.query(query, params);
  if (result.rows.length === 0) {
    return errorMsg ? { error: errorMsg, status: 404 } : null;
  }
  return result.rows[0];
}
