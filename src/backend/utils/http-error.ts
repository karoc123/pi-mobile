export type ApiErrorCode = "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "validation_error" | "runtime_error" | "internal_error";

type HttpErrorOptions = {
  details?: unknown;
  retriable?: boolean;
};

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly retriable: boolean;

  constructor(statusCode: number, code: ApiErrorCode, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.retriable = options.retriable ?? statusCode >= 500;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
