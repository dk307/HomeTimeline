const BASE = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { signal, ...rest } = options ?? {};
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, options);
  } catch (err) {
    // jsdom's AbortController lives in a separate V8 realm and its signals
    // fail Node's native fetch() instanceof check. If the signal hasn't been
    // aborted yet, retry without it so the request can proceed (the signal is
    // only used for cancellation, not data integrity).
    if (signal && !signal.aborted && err instanceof TypeError) {
      res = await fetch(`${BASE}${path}`, rest);
    } else if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
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
