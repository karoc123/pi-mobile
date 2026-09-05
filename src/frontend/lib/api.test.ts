import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, ApiRequestError } from "./api.js";

describe("apiFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on successful 200 response", async () => {
    const mockData = { ok: true, repos: ["repo-a"] };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await apiFetch<typeof mockData>("/api/repos");
    expect(result).toEqual(mockData);
  });

  it("returns undefined on 204 No Content response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiFetch("/api/logout", { method: "POST" });
    expect(result).toBeUndefined();
  });

  it("automatically sets Content-Type application/json when body is present", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await apiFetch("/api/test", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
    });

    const calledInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(calledInit.headers.get("Content-Type")).toBe("application/json");
  });

  it("parses structured ApiErrorResponse on failure", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "bad_request",
          message: "Custom validation message",
          requestId: "req-123",
          retriable: false,
        },
      }),
    });

    await expect(apiFetch("/api/fail")).rejects.toThrowError(ApiRequestError);

    try {
      await apiFetch("/api/fail");
    } catch (err) {
      const error = err as ApiRequestError;
      expect(error.status).toBe(400);
      expect(error.code).toBe("bad_request");
      expect(error.message).toBe("Custom validation message");
      expect(error.requestId).toBe("req-123");
      expect(error.retriable).toBe(false);
    }
  });

  it("falls back to default message if error response is not JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    await expect(apiFetch("/api/bad-gateway")).rejects.toThrow("Request failed with status 502.");
  });
});
