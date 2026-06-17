import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendVerificationEmail, send2FAEmail, sendPasswordResetEmail } from '../utils/email.js';
import { pgUserSource } from '../sources/userSource.js';
import { User } from '../models/user.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

const kafka = new Kafka({
  clientId: 'preempt-email-worker',
  brokers: [process.env.KAFKA_BROKERS || 'kafka:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ groupId: 'email-group' });
const producer = kafka.producer();

async function startWorker() {
  try {
    await producer.connect();
    await consumer.connect();
    console.log("Connected to Kafka as Consumer and Producer");
  } catch (err) {
    console.error("Failed to connect to Kafka, retrying...", err);
    setTimeout(startWorker, 5000);
    return;
  }

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
            console.error(`User or email not found for username: ${username}`);
            return;
          }
          
          if (type === 'VERIFY') {
            await sendVerificationEmail(user.email, tokenValue);
          } else if (type === '2FA') {
            await send2FAEmail(user.email, tokenValue);
          } else if (type === 'RESET') {
            await sendPasswordResetEmail(user.email, username, tokenValue);
          }
          
          console.log(`Successfully sent ${type} email to ${username}`);
        }
      } catch (err: any) {
        console.error("Error processing message, pushing to dead letter / error topic:", err);
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
          console.error("Failed to push error event to Kafka", producerErr);
        }
      }
      }
    });
  } catch (err) {
    console.error("Fatal error during consumer run:", err);
    setTimeout(startWorker, 5000);
  }
}

startWorker().catch(console.error);
