import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer } from "ws";

import type { AgentSnapshot, WebsocketEnvelope } from "../../shared/contracts.js";

import { AuthService } from "./auth-service.js";
import type { LogChannel } from "./log-service.js";

export class WebsocketHub {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly logger: LogChannel;

  constructor(
    private readonly authService: AuthService,
    private readonly sessionCookieName: string,
    private readonly snapshotProvider: () => AgentSnapshot,
    logger?: LogChannel,
  ) {
    this.logger = logger ?? createNoopLogger();

    this.server.on("connection", (socket) => {
      this.logger.info("WebSocket client connected.", {
        event: "ws_connected",
        details: {
          clients: this.server.clients.size,
        },
      });

      socket.send(JSON.stringify({ type: "connected", payload: this.snapshotProvider() } satisfies WebsocketEnvelope));

      socket.on("close", () => {
        this.logger.info("WebSocket client disconnected.", {
          event: "ws_disconnected",
          details: {
            clients: this.server.clients.size,
          },
        });
      });
    });
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const token = extractCookie(request.headers.cookie, this.sessionCookieName);

    if (!this.authService.isValid(token)) {
      this.logger.warn("Rejected unauthorized WebSocket upgrade.", {
        event: "ws_upgrade_rejected",
      });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    this.server.handleUpgrade(request, socket, head, (client) => {
      this.server.emit("connection", client, request);
    });
  }

  broadcast(event: WebsocketEnvelope) {
    const payload = JSON.stringify(event);

    for (const client of this.server.clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          this.logger.warn("Failed to broadcast WebSocket event.", {
            event: "ws_broadcast_failed",
            details: {
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }
  }
}

function createNoopLogger(): LogChannel {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

export function extractCookie(headerValue: string | undefined, cookieName: string) {
  if (!headerValue) {
    return null;
  }

  const cookies = headerValue.split(";").map((entry) => entry.trim());
  const matched = cookies.find((entry) => entry.startsWith(`${cookieName}=`));
  return matched ? decodeURIComponent(matched.slice(cookieName.length + 1)) : null;
}
