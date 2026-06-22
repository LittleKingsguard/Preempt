import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendVerificationEmail, send2FAEmail, sendPasswordResetEmail } from '../utils/email.js';
import { pgUserSource } from '../sources/userSource.js';
import { User } from '../models/user.js';
import { logger } from '../utils/logger.js';
import { pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

if (!process.env.KAFKA_BROKERS) {
  logger.error('KAFKA_BROKERS environment variable is required');
  process.exit(1);
}

const kafka = new Kafka({
  clientId: 'preempt-email-worker',
  brokers: [process.env.KAFKA_BROKERS],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ groupId: 'email-group' });
const producer = kafka.producer();
let isShuttingDown = false;

async function startWorker() {
  try {
    await producer.connect();
    await consumer.connect();
    logger.info("Connected to Kafka as Consumer and Producer");
  } catch (err) {
    if (isShuttingDown) return;
    logger.error({ err }, "Failed to connect to Kafka, retrying...");
    setTimeout(startWorker, 5000);
    return;
  }

  async function shutdown(signal: string) {
    logger.info(`Received ${signal}. Shutting down Email Worker gracefully...`);
    isShuttingDown = true;
    try {
      await consumer.disconnect();
      logger.info('Kafka consumer disconnected');
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

  try {
    await consumer.subscribe({ topic: 'preempt-events', fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;
      
      try {
        const eventData = JSON.parse(message.value.toString());
        
        if (eventData.type === 'auth.create' && eventData.state_change) {
          const stateChange = typeof eventData.state_change === 'string' 
            ? JSON.parse(eventData.state_change) 
            : eventData.state_change;
            
          const after = stateChange.after;
          if (!after || !after.username || !after.type || !after.tokenValue) return;
          
          const { username, type, tokenValue } = after;
          
          const user = await User.getByUsername(pgUserSource, username);
          
          if (!user || !user.email) {
            logger.error(`User or email not found for username: ${username}`);
            return;
          }
          
          if (type === 'VERIFY') {
            await sendVerificationEmail(user.email, tokenValue);
          } else if (type === '2FA') {
            await send2FAEmail(user.email, tokenValue);
          } else if (type === 'RESET') {
            await sendPasswordResetEmail(user.email, username, tokenValue);
          }
          
          logger.info(`Successfully sent ${type} email to ${username}`);
        }
      } catch (err: any) {
        logger.error({ err }, "Error processing message, pushing to dead letter / error topic");
        try {
          await producer.send({
            topic: 'preempt-events-errors',
            messages: [
              {
                value: JSON.stringify({
                  original_message: message.value.toString(),
                  error: err.message || 'Unknown error'
                })
              }
            ]
          });
        } catch (producerErr) {
          logger.error({ err: producerErr }, "Failed to push error event to Kafka");
        }
      }
      }
    });
  } catch (err) {
    if (isShuttingDown) return;
    logger.error({ err }, "Fatal error during consumer run");
    setTimeout(startWorker, 5000);
  }
}

startWorker().catch(err => {
  logger.error({ err }, 'Fatal error starting email worker');
});
