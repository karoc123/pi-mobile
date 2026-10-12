import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer } from 'ws';

import type { AgentSnapshot, WebsocketEnvelope } from '../../shared/contracts.js';

import { AuthService } from './auth-service.js';
import { noopLogger, type LogChannel } from './log-service.js';

export class WebsocketHub {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly logger: LogChannel;
  private readonly pingInterval: NodeJS.Timeout;

  constructor(
    private readonly authService: AuthService,
    private readonly sessionCookieName: string,
    private readonly snapshotProvider: () => AgentSnapshot,
    logger?: LogChannel,
  ) {
    this.logger = logger ?? noopLogger;

    this.server.on('connection', (socket) => {
      const aliveSocket = socket as typeof socket & { isAlive?: boolean };
      aliveSocket.isAlive = true;

      socket.on('pong', () => {
        aliveSocket.isAlive = true;
      });

      this.logger.info('WebSocket client connected.', {
        event: 'ws_connected',
        details: {
          clients: this.server.clients.size,
        },
      });

      socket.send(
        JSON.stringify({
          type: 'snapshot',
          payload: this.snapshotProvider(),
        } satisfies WebsocketEnvelope),
      );

      socket.on('close', () => {
        this.logger.info('WebSocket client disconnected.', {
          event: 'ws_disconnected',
          details: {
            clients: this.server.clients.size,
          },
        });
      });
    });

    this.pingInterval = setInterval(() => {
      for (const client of this.server.clients) {
        const aliveClient = client as typeof client & { isAlive?: boolean };
        if (aliveClient.isAlive === false) {
          client.terminate();
          continue;
        }
        aliveClient.isAlive = false;
        client.ping();
      }
    }, 30_000);
    this.pingInterval.unref();
  }

  close() {
    clearInterval(this.pingInterval);
    for (const client of this.server.clients) client.terminate();
    this.server.close();
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const token = extractCookie(request.headers.cookie, this.sessionCookieName);

    if (!this.authService.isValid(token)) {
      this.logger.warn('Rejected unauthorized WebSocket upgrade.', {
        event: 'ws_upgrade_rejected',
      });
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this.server.handleUpgrade(request, socket, head, (client) => {
      this.server.emit('connection', client, request);
    });
  }

  broadcast(event: WebsocketEnvelope) {
    const payload = JSON.stringify(event);

    for (const client of this.server.clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          this.logger.warn('Failed to broadcast WebSocket event.', {
            event: 'ws_broadcast_failed',
            details: {
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }
  }
}

export function extractCookie(headerValue: string | undefined, cookieName: string) {
  if (!headerValue) {
    return null;
  }

  const cookies = headerValue.split(';').map((entry) => entry.trim());
  const matched = cookies.find((entry) => entry.startsWith(`${cookieName}=`));
  try {
    return matched ? decodeURIComponent(matched.slice(cookieName.length + 1)) : null;
  } catch {
    return null;
  }
}
