type EventCallback = (payload: any) => void;

/**
 * Client-side WebSocket connection manager handling real-time server events, subscriptions, and automatic reconnects.
 *
 * @useCase Subscribes to real-time database updates or live handler modification events broadcast from server.
 * @processFlow Re-connects automatically on disconnect and resubscribes active topics.
 */
export class WebSocketClient {
  private static instance: WebSocketClient;
  private ws: WebSocket | null = null;
  private url: string;
  private subscriptions: Map<string, Set<EventCallback>> = new Map();
  private reconnectInterval: number = 3000;
  private isConnecting: boolean = false;

  private constructor(url: string) {
    this.url = url;
    this.connect();
  }

  /**
   * Returns or initializes the global WebSocketClient singleton instance.
   *
   * @param url Optional WebSocket URL string.
   * @returns WebSocketClient instance.
   */
  public static getInstance(url?: string): WebSocketClient {
    if (!url) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${protocol}//${window.location.host}`;
    }
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient(url);
    }
    return WebSocketClient.instance;
  }

  private connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnecting = false;
        console.log('WebSocket connected');
        // Resubscribe to all existing topics
        for (const topic of this.subscriptions.keys()) {
          this.sendSubscribe(topic);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.topic && this.subscriptions.has(data.topic)) {
            const callbacks = this.subscriptions.get(data.topic)!;
            callbacks.forEach(cb => cb(data.payload));
          }
        } catch (err) {
          console.error('Error parsing WebSocket message', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.ws = null;
        console.log('WebSocket disconnected. Reconnecting...');
        setTimeout(() => this.connect(), this.reconnectInterval);
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        // Let onclose handle reconnect
      };
    } catch (err) {
      this.isConnecting = false;
      console.error('WebSocket connection failed:', err);
      setTimeout(() => this.connect(), this.reconnectInterval);
    }
  }

  private sendSubscribe(topic: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', topic }));
    }
  }

  /**
   * Subscribes a callback function to messages published on a specific topic.
   *
   * @param topic Target topic name string.
   * @param callback Callback function executed on incoming payload.
   * @returns Unsubscribe function.
   */
  public subscribe(topic: string, callback: EventCallback) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
      this.sendSubscribe(topic);
    }
    this.subscriptions.get(topic)!.add(callback);
    return () => this.unsubscribe(topic, callback);
  }

  /**
   * Unsubscribes a callback function from a specific topic.
   *
   * @param topic Target topic string.
   * @param callback Registered callback function.
   */
  public unsubscribe(topic: string, callback: EventCallback) {
    if (this.subscriptions.has(topic)) {
      const callbacks = this.subscriptions.get(topic)!;
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscriptions.delete(topic);
        // Note: we might want to tell the server to unsubscribe if desired.
      }
    }
  }
}

