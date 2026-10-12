import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

export interface WsMessage {
  event: string;
  data: any;
  timestamp: string;
}

class WsManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  public init(server: HttpServer): WebSocketServer {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // Send initial welcome message
      ws.send(
        JSON.stringify({
          event: 'connected',
          data: { message: 'Connected to OXIDE Bot Monitor Realtime Stream' },
          timestamp: new Date().toISOString(),
        })
      );

      ws.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.event === 'ping') {
            ws.send(
              JSON.stringify({
                event: 'pong',
                data: { timestamp: new Date().toISOString() },
                timestamp: new Date().toISOString(),
              })
            );
          }
        } catch {
          // ignore non-json
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    return this.wss;
  }

  public broadcast(event: string, data: any): void {
    const payload = JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          this.clients.delete(client);
        }
      }
    }
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}

export const wsManager = new WsManager();
