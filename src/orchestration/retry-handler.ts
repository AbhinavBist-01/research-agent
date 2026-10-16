export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: string[];
  signal?: AbortSignal;
}

/**
 * Executes an async operation with bounded exponential backoff and jitter
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<{ result: T; attempts: number }> {
  const maxAttempts = options.maxAttempts || 3;
  const baseDelayMs = options.baseDelayMs || 200;
  const maxDelayMs = options.maxDelayMs || 2000;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check abort signal before starting attempt
    if (options.signal?.aborted) {
      throw new Error("Operation cancelled via AbortSignal.");
    }

    try {
      const result = await operation(attempt);
      return { result, attempts: attempt };
    } catch (err: any) {
      lastError = err;

      if (attempt >= maxAttempts) {
        break;
      }

      // Check if error is retryable (network drops, rate limits, timeouts)
      const errString = (err?.message || String(err)).toLowerCase();
      const isRetryable =
        errString.includes("timeout") ||
        errString.includes("econnreset") ||
        errString.includes("429") ||
        errString.includes("rate limit") ||
        errString.includes("503") ||
        errString.includes("502");

      if (!isRetryable && options.retryableErrors && options.retryableErrors.length > 0) {
        const matchesCustom = options.retryableErrors.some((e) => errString.includes(e.toLowerCase()));
        if (!matchesCustom) {
          throw err; // Non-retryable failure, abort immediately
        }
      }

      // Calculate exponential backoff with full jitter
      const rawDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(maxDelayMs, rawDelay + jitter);

      console.warn(`[RetryHandler] Attempt ${attempt} failed: ${err.message}. Retrying in ${Math.round(delay)}ms...`);

      // Sleep with abort signal listening
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (options.signal) {
          options.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("Operation cancelled via AbortSignal during retry backoff."));
            },
            { once: true }
          );
        }
      });
    }
  }

  throw lastError;
}
