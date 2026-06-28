import { Kafka } from 'kafkajs';
import { pool } from '../db.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

if (!process.env.KAFKA_BROKERS) {
  logger.error('KAFKA_BROKERS environment variable is required');
  process.exit(1);
}

const kafka = new Kafka({
  clientId: 'preempt-relay',
  brokers: [process.env.KAFKA_BROKERS],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const producer = kafka.producer();
let isShuttingDown = false;

async function startRelay() {
  try {
    await producer.connect();
    logger.info("Connected to Kafka as Producer");
  } catch (err) {
    if (isShuttingDown) return;
    logger.error({ err }, "Failed to connect to Kafka, retrying...");
    setTimeout(startRelay, 5000);
    return;
  }

  // Poll DB periodically
  const interval = setInterval(() => {
    if (!isShuttingDown) {
      pollEvents();
    }
  }, 1000);

  async function shutdown(signal: string) {
    logger.info(`Received ${signal}. Shutting down Event Relay gracefully...`);
    isShuttingDown = true;
    clearInterval(interval);
    try {
      await producer.disconnect();
      logger.info('Kafka producer disconnected');
      await pool.end();
      logger.info('Database pool closed');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function pollEvents() {
  if (isShuttingDown) return;
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    
    // Select batch of events, locking them and marking as PROCESSING
    result = await client.query(`
      UPDATE Events
      SET status = 'PROCESSING', processing_started_at = CURRENT_TIMESTAMP
      WHERE event_id IN (
        SELECT event_id 
        FROM Events 
        WHERE status = 'PENDING' OR (status = 'PROCESSING' AND processing_started_at < CURRENT_TIMESTAMP - INTERVAL '1 minute')
        ORDER BY timestamp ASC 
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      )
      RETURNING event_id, type, timestamp, source_id, source_type, interested_parties, state_change, correlation_id, version, topic 
    `);

    await client.query('COMMIT');
  } catch (dbErr: any) {
    if (dbErr.code !== '42P01') {
      logger.error({ err: dbErr }, "Error polling database for events");
    }
    await client.query('ROLLBACK');
    client.release();
    return;
  }

  if (result.rows.length === 0) {
    client.release();
    return;
  }

  const messagesByTopic: Record<string, any[]> = {};
  for (const row of result.rows) {
    const topic = row.topic || 'preempt-events';
    if (!messagesByTopic[topic]) messagesByTopic[topic] = [];
    messagesByTopic[topic].push({
      key: row.event_id,
      value: JSON.stringify(row)
    });
  }

  try {
    const sendPromises = Object.entries(messagesByTopic).map(([topic, messages]) => {
      return producer.send({
        topic,
        messages
      });
    });
    await Promise.all(sendPromises);

    // If successful, delete from DB
    const ids = result.rows.map(r => r.event_id);
    await client.query('DELETE FROM Events WHERE event_id = ANY($1)', [ids]);
    logger.info(`Relayed ${ids.length} events to Kafka`);
  } catch (kafkaErr) {
    logger.error({ err: kafkaErr }, "Failed to push to Kafka, events will be retried later...");
  } finally {
    client.release();
  }
}

startRelay().catch(err => {
  logger.error({ err }, 'Fatal error starting relay');
});
