/**
 * Generic SSE stream reader for consuming Server-Sent Events from the backend.
 * Re-usable across all streaming endpoints.
 */

export type SSEEvent<T = Record<string, unknown>> = T & { type: string };

export interface SSEStreamOptions<T> {
  /** URL to POST/GET */
  url: string;
  /** HTTP method (default: POST) */
  method?: "GET" | "POST";
  /** JSON body for POST requests */
  body?: unknown;
  /** Called for every SSE event */
  onEvent: (event: SSEEvent<T>) => void;
  /** Called when the stream encounters an error event or network failure */
  onError?: (message: string) => void;
  /** Called when the stream ends (after complete or error) */
  onDone?: () => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Consume an SSE stream from the backend.
 * Returns a promise that resolves when the stream is fully consumed.
 */
export async function consumeSSEStream<T = Record<string, unknown>>(
  opts: SSEStreamOptions<T>,
): Promise<void> {
  const { url, method = "POST", body, onEvent, onError, onDone, signal } = opts;

  const fetchOpts: RequestInit = {
    method,
    signal,
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  };

  let res: Response;
  try {
    res = await fetch(url, fetchOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    onError?.(msg);
    onDone?.();
    return;
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as {
        detail?:
          | { error?: string }
          | string
          | Array<{ loc?: (string | number)[]; msg?: string }>;
      };
      const d = data?.detail;
      if (Array.isArray(d) && d.length > 0) {
        const parts = d
          .map((e) => e.msg)
          .filter((m): m is string => typeof m === "string" && m.length > 0);
        if (parts.length > 0) msg = parts.join("; ");
      } else if (typeof d === "object" && d && "error" in d && typeof d.error === "string") {
        msg = d.error;
      } else if (typeof d === "string") msg = d;
    } catch {
      // ignore parse error
    }
    onError?.(msg);
    onDone?.();
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError?.("No response stream");
    onDone?.();
    return;
  }

  const dec = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.trim();
        if (!line.startsWith("data: ")) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (!raw || typeof raw !== "object" || !("type" in raw)) continue;
        const event = raw as SSEEvent<T>;
        if (event.type === "error") {
          onError?.((event as unknown as { message?: string }).message || "Stream error");
          continue;
        }
        onEvent(event);
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : "Stream read failed";
    onError?.(msg);
  } finally {
    onDone?.();
  }
}
