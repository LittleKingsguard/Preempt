type EventCallback = (payload: any) => void;

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

  public subscribe(topic: string, callback: EventCallback) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
      this.sendSubscribe(topic);
    }
    this.subscriptions.get(topic)!.add(callback);
    return () => this.unsubscribe(topic, callback);
  }

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
