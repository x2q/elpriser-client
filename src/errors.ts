/**
 * Errors thrown by the client. Everything this package throws on purpose derives
 * from {@link ElpriserError}, except abort errors: when you abort a request with
 * your own `AbortSignal`, the signal's reason (normally an `AbortError`) is
 * rethrown unchanged, as `fetch` itself does.
 */

/** Base class of every error this package throws on purpose. */
export class ElpriserError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * A call was made with an argument the API (or this client) cannot accept: a bad
 * mode, an out-of-range `hours`, a malformed date. Thrown before any request is
 * made. The analogue of Python's `ValueError`.
 */
export class InvalidArgumentError extends ElpriserError {}

/** The zone is not one of the 40 zones elpriser.org serves (see `ZONES`). */
export class UnknownZoneError extends InvalidArgumentError {}

/**
 * The request never produced an HTTP answer: DNS, TLS, refused, reset. Thrown only
 * after the configured retries are used up; `cause` holds the underlying error.
 */
export class ElpriserNetworkError extends ElpriserError {}

/** The request timed out (after the configured retries). */
export class ElpriserTimeoutError extends ElpriserNetworkError {}

/** A 200 answer whose body is not the shape this version understands. */
export class ElpriserParseError extends ElpriserError {}

/** What an {@link ApiError} carries. */
export interface ApiErrorInit {
  /** The HTTP status code. */
  status: number;
  /** The URL that was requested. */
  url: string;
  /**
   * The response body: the decoded JSON when the body is JSON, otherwise the raw
   * text.
   */
  body: unknown;
  /** The server's `Retry-After` in seconds, when it sent one. */
  retryAfter?: number | null;
}

/**
 * The API answered with an HTTP error status. `status` is the code, `body` the
 * response body (decoded JSON, or text), `message` carries the API's own `error`
 * text when it sent one.
 */
export class ApiError extends ElpriserError {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  /** The server's `Retry-After` in seconds, when it sent one. */
  readonly retryAfter: number | null;

  constructor(message: string, init: ApiErrorInit) {
    super(message);
    this.status = init.status;
    this.url = init.url;
    this.body = init.body;
    this.retryAfter = init.retryAfter ?? null;
  }
}

/** HTTP 400: the API rejected a parameter (unknown zone, mode, bad date ...). */
export class BadRequestError extends ApiError {}

/** HTTP 404: the API has no prices for this request (yet). */
export class NotFoundError extends ApiError {}

/** HTTP 429 (after the retries). `retryAfter` is the server's `Retry-After` in seconds. */
export class RateLimitError extends ApiError {}

/** HTTP 5xx (after the retries). A 503 may carry `retryAfter`. */
export class ServerError extends ApiError {}
