// @vitest-environment node

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import type { AgentSnapshot, WebsocketEnvelope } from "../../shared/contracts.js";
import { AuthService } from "./auth-service.js";
import { extractCookie, WebsocketHub } from "./websocket-hub.js";

describe("WebsocketHub", () => {
  const cookieName = "pi_session";
  const dummySnapshot: AgentSnapshot = {
    status: "idle",
    activePrompt: null,
    history: [],
    models: [],
    thinkingLevels: [],
    selectedModel: null,
    selectedThinkingLevel: null,
    steeringMode: "all",
    followUpMode: "one-at-a-time",
    autoCompactEnabled: false,
    activeInteractivePrompt: null,
  };

  describe("extractCookie", () => {
    it("extracts and decodes named cookie from Cookie header", () => {
      expect(extractCookie(undefined, cookieName)).toBeNull();
      expect(extractCookie("", cookieName)).toBeNull();
      expect(extractCookie("other=123", cookieName)).toBeNull();
      expect(extractCookie(`other=123; ${cookieName}=abc-token; foo=bar`, cookieName)).toBe("abc-token");
      expect(extractCookie(`${cookieName}=hello%20world`, cookieName)).toBe("hello world");
    });
  });

  describe("handleUpgrade", () => {
    it("rejects unauthorized upgrade requests with 401 and destroys socket", () => {
      const authService = new AuthService("secret");
      const hub = new WebsocketHub(authService, cookieName, () => dummySnapshot);

      const mockSocket = {
        write: vi.fn(),
        destroy: vi.fn(),
      } as unknown as Duplex;

      const reqMissing = {
        headers: {},
      } as unknown as IncomingMessage;

      hub.handleUpgrade(reqMissing, mockSocket, Buffer.alloc(0));

      expect(mockSocket.write).toHaveBeenCalledWith("HTTP/1.1 401 Unauthorized\r\n\r\n");
      expect(mockSocket.destroy).toHaveBeenCalled();

      const reqInvalid = {
        headers: { cookie: `${cookieName}=invalid-token` },
      } as unknown as IncomingMessage;

      hub.handleUpgrade(reqInvalid, mockSocket, Buffer.alloc(0));
      expect(mockSocket.destroy).toHaveBeenCalledTimes(2);
    });

    it("proceeds with upgrade when valid session token cookie is provided", () => {
      const authService = new AuthService("secret");
      const validToken = authService.login("secret")!;
      const hub = new WebsocketHub(authService, cookieName, () => dummySnapshot);

      const server = (hub as unknown as { server: { handleUpgrade: ReturnType<typeof vi.fn> } }).server;
      server.handleUpgrade = vi.fn();

      const mockSocket = {
        write: vi.fn(),
        destroy: vi.fn(),
      } as unknown as Duplex;

      const reqValid = {
        headers: { cookie: `${cookieName}=${validToken}` },
      } as unknown as IncomingMessage;

      hub.handleUpgrade(reqValid, mockSocket, Buffer.alloc(0));

      expect(server.handleUpgrade).toHaveBeenCalled();
      expect(mockSocket.destroy).not.toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("sends payload to all open sockets and ignores closed sockets", () => {
      const authService = new AuthService("secret");
      const hub = new WebsocketHub(authService, cookieName, () => dummySnapshot);

      const openSocket = {
        OPEN: WebSocket.OPEN,
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      };
      const closedSocket = {
        OPEN: WebSocket.OPEN,
        readyState: WebSocket.CLOSED,
        send: vi.fn(),
      };

      const server = (hub as unknown as { server: { clients: Set<unknown> } }).server;
      server.clients = new Set([openSocket, closedSocket]);

      const event: WebsocketEnvelope = {
        type: "session_compacted",
        payload: { message: "Compacted" },
      };

      hub.broadcast(event);

      expect(openSocket.send).toHaveBeenCalledWith(JSON.stringify(event));
      expect(closedSocket.send).not.toHaveBeenCalled();
    });
  });
});
