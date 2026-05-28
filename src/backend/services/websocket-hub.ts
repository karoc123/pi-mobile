import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer } from 'ws';

import type { AgentSnapshot, WebsocketEnvelope } from '../../shared/contracts.js';

import { AuthService } from './auth-service.js';

export class WebsocketHub {
  private readonly server = new WebSocketServer({ noServer: true });

  constructor(
    private readonly authService: AuthService,
    private readonly sessionCookieName: string,
    private readonly snapshotProvider: () => AgentSnapshot
  ) {
    this.server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'connected', payload: this.snapshotProvider() } satisfies WebsocketEnvelope));
    });
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const token = extractCookie(request.headers.cookie, this.sessionCookieName);

    if (!this.authService.isValid(token)) {
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
        client.send(payload);
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
  return matched ? decodeURIComponent(matched.slice(cookieName.length + 1)) : null;
}