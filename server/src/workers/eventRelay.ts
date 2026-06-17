import { Kafka } from 'kafkajs';
import { pool } from '../db.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const kafka = new Kafka({
  clientId: 'preempt-relay',
  brokers: [process.env.KAFKA_BROKERS || 'kafka:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const producer = kafka.producer();

async function startRelay() {
  try {
    await producer.connect();
    console.log("Connected to Kafka as Producer");
  } catch (err) {
    console.error("Failed to connect to Kafka, retrying...", err);
    setTimeout(startRelay, 5000);
    return;
  }

  // Poll DB periodically
  setInterval(pollEvents, 1000);
}

async function pollEvents() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Select batch of events, locking them
    const result = await client.query(`
      SELECT event_id, type, timestamp, source_id, source_type, interested_parties, state_change, correlation_id, version 
      FROM Events 
      ORDER BY timestamp ASC 
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    `);

    if (result.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const messages = result.rows.map(row => ({
      key: row.event_id,
      value: JSON.stringify(row)
    }));

    try {
      await producer.send({
        topic: 'preempt-events',
        messages
      });

      // If successful, delete from DB
      const ids = result.rows.map(r => r.event_id);
      await client.query('DELETE FROM Events WHERE event_id = ANY($1)', [ids]);
      
      await client.query('COMMIT');
      console.log(`Relayed ${ids.length} events to Kafka`);
    } catch (kafkaErr) {
      console.error("Failed to push to Kafka, rolling back DB transaction...", kafkaErr);
      await client.query('ROLLBACK');
    }

  } catch (dbErr) {
    console.error("Error polling database for events:", dbErr);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

startRelay().catch(console.error);
