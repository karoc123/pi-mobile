import type { ApiErrorResponse } from '../../shared/contracts.js';
import { toast } from './toast.svelte.js';

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
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.retriable = options.retriable ?? options.status >= 500;
    this.details = options.details;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: init.cache ?? 'no-store',
    ...init,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && url.split('?')[0] !== '/api/auth/login' && unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw await toApiRequestError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  get<T>(url: string, init?: RequestInit): Promise<T> {
    return apiFetch<T>(url, { ...init, method: 'GET' });
  },
  post<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...init,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
  put<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
    return apiFetch<T>(url, {
      ...init,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
  del<T>(url: string, init?: RequestInit): Promise<T> {
    return apiFetch<T>(url, { ...init, method: 'DELETE' });
  },
};

export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const requestHint = error.requestId ? ` (request ${error.requestId})` : '';
    return `${error.message}${requestHint}`;
  }

  return error instanceof Error ? error.message : 'Unexpected error.';
}

export interface RunOptions<T = unknown> {
  okText?: string | ((result: T) => string);
  busy?: (isBusy: boolean) => void;
  rethrow?: boolean;
}

export async function run<T>(
  action: () => Promise<T>,
  { okText, busy, rethrow = false }: RunOptions<T> = {},
): Promise<T | null> {
  busy?.(true);

  try {
    const result = await action();
    if (okText) {
      const message = typeof okText === 'function' ? okText(result) : okText;
      if (message) {
        toast.show(message, 'success');
      }
    }
    return result;
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.status === 401)) {
      toast.show(toErrorMessage(error), 'error');
    }
    if (rethrow) {
      throw error;
    }
    return null;
  } finally {
    busy?.(false);
  }
}

async function toApiRequestError(response: Response): Promise<ApiRequestError> {
  try {
    const payload = (await response.json()) as Partial<ApiErrorResponse> & { message?: string };

    if (
      payload &&
      typeof payload === 'object' &&
      payload.error &&
      typeof payload.error === 'object'
    ) {
      const error = payload.error;
      return new ApiRequestError(
        error.message ?? `Request failed with status ${response.status}.`,
        {
          status: response.status,
          code: error.code,
          requestId: error.requestId,
          retriable: error.retriable,
          details: error.details,
        },
      );
    }

    if (typeof payload.message === 'string' && payload.message.length > 0) {
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
