/**
 * Safe, user-facing error description.
 *
 * Deliberately free of any `vscode` import so it stays a pure function,
 * testable on its own (mirrors treePaths.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * Interpolating a raw `error.message` (or the error object) straight into a
 * toast, webview, or document leaks internal implementation detail: server
 * stack fragments, file-system paths, axios request URLs with query strings,
 * and driver-level messages. That is the class of bug flagged by
 * `datadog/javascript-errorinfoleak`.
 *
 * `describeError()` maps an unknown thrown value onto a short, curated phrase
 * that is safe to show a user. Known transport conditions (HTTP status,
 * timeouts, connection refused) get a friendly explanation; everything else
 * falls back to a generic phrase rather than echoing the raw message.
 */

/** Shape we care about when a thrown value looks like an axios error. */
interface TransportErrorShape {
  code?: unknown;
  response?: { status?: unknown; statusText?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Map an HTTP status code to a safe, user-facing phrase.
 * Returns `undefined` when the status is not one we have specific copy for.
 */
function messageForStatus(status: number): string | undefined {
  if (status === 401 || status === 403) {
    return 'You are not signed in, or your session has expired.';
  }
  if (status === 404) {
    return 'The requested item could not be found on the server.';
  }
  if (status === 429) {
    return 'Too many requests — please wait a moment and try again.';
  }
  if (status >= 500) {
    return 'The server reported an internal error. Please try again later.';
  }
  if (status >= 400) {
    return 'The server rejected the request.';
  }
  return undefined;
}

/**
 * Turn an unknown thrown value into a short phrase that is safe to show a user.
 *
 * Never returns the raw `error.message`; internal detail is intentionally
 * dropped. Callers should still log the original error to the extension's
 * output channel for diagnostics when appropriate.
 *
 * @param error - whatever landed in a `catch` block
 * @param fallback - phrase to use when nothing more specific is known
 * @return a sanitized, user-safe description
 */
export function describeError(
  error: unknown,
  fallback = 'An unexpected error occurred.'
): string {
  if (!isRecord(error)) {
    return fallback;
  }

  const err = error as TransportErrorShape;

  // Prefer HTTP status when this looks like an axios/fetch transport error.
  const status = err.response?.status;
  if (typeof status === 'number') {
    const phrase = messageForStatus(status);
    if (phrase) {
      return phrase;
    }
  }

  // Common low-level network conditions, keyed on the (non-sensitive) code.
  const code = typeof err.code === 'string' ? err.code : undefined;
  switch (code) {
    case 'ECONNREFUSED':
    case 'ERR_CONNECTION_REFUSED':
      return 'Could not reach the server. Is it running and the URL correct?';
    case 'ETIMEDOUT':
    case 'ECONNABORTED':
      return 'The request timed out. Please check your connection and try again.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Could not resolve the server address. Please check the configured URL.';
    default:
      break;
  }

  return fallback;
}
