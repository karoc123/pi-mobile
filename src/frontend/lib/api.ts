import type { ApiErrorResponse } from "../../shared/contracts.js";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly retriable: boolean;
  readonly details: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | null;
      requestId?: string | null;
      retriable?: boolean;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.retriable = options.retriable ?? options.status >= 500;
    this.details = options.details;
  }
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (!response.ok) {
    throw await toApiRequestError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function toApiRequestError(response: Response) {
  try {
    const payload = (await response.json()) as Partial<ApiErrorResponse> & { message?: string };

    if (payload && typeof payload === "object" && payload.error && typeof payload.error === "object") {
      const error = payload.error;
      return new ApiRequestError(error.message ?? `Request failed with status ${response.status}.`, {
        status: response.status,
        code: error.code,
        requestId: error.requestId,
        retriable: error.retriable,
        details: error.details,
      });
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return new ApiRequestError(payload.message, {
        status: response.status,
      });
    }
  } catch {
    // Ignore JSON parse errors and use default status-based message below.
  }

  return new ApiRequestError(`Request failed with status ${response.status}.`, {
    status: response.status,
  });
}
