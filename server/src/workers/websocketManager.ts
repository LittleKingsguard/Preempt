import { WebSocketServer, WebSocket } from 'ws';
import { Kafka } from 'kafkajs';
import crypto from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

interface SubscribeMessage {
  type: 'subscribe';
  topic: string;
}

function parseTokenFromCookie(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|; )token=([^;]*)/);
  return match ? match[1] || null : null;
}

export function initWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server });

  // Map of client connections to their subscribed topics
  const clientSubscriptions = new Map<WebSocket, Set<string>>();

  wss.on('connection', (ws, req) => {
    const token = parseTokenFromCookie(req.headers.cookie);
    if (!token) {
      logger.warn('WebSocket connection attempt without token');
      ws.close(1008, 'Unauthorized');
      return;
    }

    try {
      jwt.verify(token, JWT_SECRET);
    } catch (err) {
      logger.warn('WebSocket connection attempt with invalid token');
      ws.close(1008, 'Unauthorized');
      return;
    }

    clientSubscriptions.set(ws, new Set());

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'subscribe' && data.topic) {
          const subs = clientSubscriptions.get(ws);
          if (subs) {
            subs.add(data.topic);
            logger.debug(`WebSocket client subscribed to ${data.topic}`);
          }
        }
      } catch (err) {
        logger.error({ err }, 'WebSocket received invalid message');
      }
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
    });
  });

  if (!process.env.KAFKA_BROKERS) {
    throw new Error('KAFKA_BROKERS environment variable is required for WebSocket Manager');
  }

  // Setup Kafka Consumer to broadcast to WS clients
  const kafka = new Kafka({
    clientId: 'preempt-ws-broadcaster',
    brokers: [process.env.KAFKA_BROKERS],
    retry: {
      initialRetryTime: 100,
      retries: 8
    }
  });

  // Use a unique group ID for every backend instance so all nodes receive all events
  const consumerGroupId = `ws-broadcaster-${crypto.randomUUID()}`;
  const consumer = kafka.consumer({ groupId: consumerGroupId });

  let isShuttingDown = false;

  async function runConsumer() {
    try {
      await consumer.connect();
      logger.info(`WebSocket broadaster connected to Kafka with group ${consumerGroupId}`);
      
      await consumer.subscribe({ topic: 'preempt-events', fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          if (!message.value) return;
          try {
            const eventPayload = JSON.parse(message.value.toString());
            // The stateChange comes from Events table (stringified JSON)
            const stateChange = eventPayload.state_change ? JSON.parse(eventPayload.state_change) : null;
            const interestedParties = eventPayload.interested_parties || [];

            // Broadcast to connected websockets
            for (const [ws, subs] of clientSubscriptions.entries()) {
              if (ws.readyState === WebSocket.OPEN) {
                // Check if client is subscribed to any of the interested parties
                const isInterested = interestedParties.some((party: string) => subs.has(party));
                if (isInterested) {
                  ws.send(JSON.stringify({
                    eventType: eventPayload.type,
                    topic: interestedParties.find((party: string) => subs.has(party)),
                    payload: stateChange?.after || stateChange?.before
                  }));
                }
              }
            }
          } catch (err) {
            logger.error({ err }, 'Error processing Kafka message for WebSocket');
          }
        },
      });
    } catch (err) {
      if (isShuttingDown) return;
      logger.error({ err }, 'WebSocket Kafka consumer error');
      setTimeout(runConsumer, 5000);
    }
  }

  runConsumer();

  return {
    shutdown: async () => {
      isShuttingDown = true;
      logger.info('Shutting down WebSocket Manager and Kafka Consumer...');
      for (const [ws] of clientSubscriptions.entries()) {
         ws.close(1001, 'Server shutting down');
      }
      try {
        await consumer.disconnect();
        logger.info('WebSocket Kafka Consumer disconnected.');
      } catch (err) {
        logger.error({ err }, 'Error disconnecting WebSocket Kafka Consumer');
      }
    }
  };
}
