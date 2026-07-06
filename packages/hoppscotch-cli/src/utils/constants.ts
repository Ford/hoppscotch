import { ResponseErrorPair } from "../interfaces/response";

export const responseErrors: ResponseErrorPair = {
  501: "REQUEST NOT SUPPORTED",
  408: "NETWORK TIMEOUT",
  400: "BAD REQUEST",
} as const;

/**
 * Default decimal precision to round-off calculated HRTime time in seconds.
 */
export const DEFAULT_DURATION_PRECISION: number = 3;

/**
 * Default request timeout in milliseconds (30 seconds).
 * Can be overridden via the --timeout CLI option.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS: number = 30_000;

/**
 * Default number of retries on transient network errors (ECONNRESET, etc.).
 * Can be overridden via the --retries CLI option.
 */
export const DEFAULT_REQUEST_RETRIES: number = 0;

/**
 * Node.js error codes that are considered transient and safe to retry.
 */
export const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

