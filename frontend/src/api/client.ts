const BASE = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { signal, ...rest } = options ?? {};
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, options);
  } catch (err) {
    // Abort: preserve the caller's reason verbatim (may be any value, not
    // just an Error — React Query passes DOMException, user code may pass
    // strings or custom objects).  Fall back to the standard DOMException
    // only when reason is explicitly undefined (not null or other falsy).
    if (signal?.aborted) {
      throw signal.reason !== undefined
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
    }
    // Signal-realm mismatch: a non-native AbortSignal (e.g. jsdom) passed
    // to Node's native fetch() triggers a TypeError.  Only retry when a
    // signal was provided and hasn't been aborted — plain TypeErrors from
    // invalid URLs, blocked requests, etc. must propagate immediately.
    if (signal && !signal.aborted && err instanceof TypeError) {
      res = await fetch(`${BASE}${path}`, { signal, ...rest });
    } else {
      throw err;
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Pass React Query's `signal` (from the queryFn context) so superseded or
  // unmounted queries abort their in-flight fetch instead of holding a browser
  // connection open — important for fast timeline scrubbing.
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
