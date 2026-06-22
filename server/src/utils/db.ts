import { pool } from "../db.js";
import type { IPreemptEvent } from "../../../src/types/Event.js";
import { logger } from "./logger.js";

export async function queryFirstRow(query: string, params: any[] = [], errorMsg?: string, client?: any): Promise<any> {
  const queryFn = client ? client.query.bind(client) : pool.query.bind(pool);
  const result = await queryFn(query, params);
  if (result.rows.length === 0) {
    return errorMsg ? { error: errorMsg, status: 404 } : null;
  }
  return result.rows[0];
}

export async function logEvent(client: any, event: IPreemptEvent) {
  const cte = getLogEventCTE(event, 1);
  await client.query(`WITH ${cte.sql} SELECT 1`, cte.params);
}

export function getLogEventCTE(event: IPreemptEvent, paramStartIndex: number) {
  const sql = `
    logged_event AS (
      INSERT INTO Events (event_id, type, timestamp, source_id, source_type, interested_parties, state_change, correlation_id, version, topic) 
      VALUES ($${paramStartIndex}, $${paramStartIndex+1}, $${paramStartIndex+2}, $${paramStartIndex+3}, $${paramStartIndex+4}, $${paramStartIndex+5}, $${paramStartIndex+6}, $${paramStartIndex+7}, $${paramStartIndex+8}, $${paramStartIndex+9}) ON CONFLICT (event_id) DO NOTHING
    )
  `;
  const params = [
    event.id, event.type, event.timestamp, event.source.id, event.source.type, 
    event.interestedParties, event.stateChange ? JSON.stringify(event.stateChange) : null,
    event.correlationId, event.version, event.topic || 'preempt-events'
  ];
  return { sql, params };
}

export function fireAndForgetEvent(event: IPreemptEvent) {
  pool.query(
    `INSERT INTO Events (event_id, type, timestamp, source_id, source_type, interested_parties, state_change, correlation_id, version, topic) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (event_id) DO NOTHING`,
    [
      event.id, event.type, event.timestamp, event.source.id, event.source.type, 
      event.interestedParties, event.stateChange ? JSON.stringify(event.stateChange) : null,
      event.correlationId, event.version, event.topic || 'preempt-events'
    ]
  ).catch(err => {
    logger.error({ err }, "Failed to fire-and-forget event save");
  });
}
