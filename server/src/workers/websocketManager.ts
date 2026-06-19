import { WebSocketServer, WebSocket } from 'ws';
import { Kafka } from 'kafkajs';
import crypto from 'crypto';
import http from 'http';

interface SubscribeMessage {
  type: 'subscribe';
  topic: string;
}

export function initWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server });

  // Map of client connections to their subscribed topics
  const clientSubscriptions = new Map<WebSocket, Set<string>>();

  wss.on('connection', (ws) => {
    clientSubscriptions.set(ws, new Set());

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'subscribe' && data.topic) {
          const subs = clientSubscriptions.get(ws);
          if (subs) {
            subs.add(data.topic);
            console.log(`WebSocket client subscribed to ${data.topic}`);
          }
        }
      } catch (err) {
        console.error('WebSocket received invalid message:', err);
      }
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
    });
  });

  // Setup Kafka Consumer to broadcast to WS clients
  const kafka = new Kafka({
    clientId: 'preempt-ws-broadcaster',
    brokers: [process.env.KAFKA_BROKERS || 'kafka:9092'],
    retry: {
      initialRetryTime: 100,
      retries: 8
    }
  });

  // Use a unique group ID for every backend instance so all nodes receive all events
  const consumerGroupId = `ws-broadcaster-${crypto.randomUUID()}`;
  const consumer = kafka.consumer({ groupId: consumerGroupId });

  async function runConsumer() {
    try {
      await consumer.connect();
      console.log(`WebSocket broadaster connected to Kafka with group ${consumerGroupId}`);
      
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
            console.error('Error processing Kafka message for WebSocket:', err);
          }
        },
      });
    } catch (err) {
      console.error('WebSocket Kafka consumer error:', err);
      setTimeout(runConsumer, 5000);
    }
  }

  runConsumer();
}
