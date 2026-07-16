import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";

// ── MSW lifecycle ────────────────────────────────────────────────────────────
// Fail loudly on any request a test forgot to mock, so tests can't silently pass
// against a real (or absent) network.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

// Node 26+ defines globalThis.localStorage as undefined. Vitest's
// populateGlobal skips keys that already exist, so happy-dom's working
// localStorage never gets installed.  Install a minimal Storage shim.
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    key(index: number) { return [...store.keys()][index] ?? null; },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
}
