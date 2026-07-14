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

// ── localStorage shim ─────────────────────────────────────────────────────────
// Node 26+ adds a native `localStorage` to globalThis. When --localstorage-file
// is not provided the global exists but is `undefined`. Vitest's jsdom environment
// skips populating keys that already exist on `global`, so jsdom's working
// localStorage never gets installed. This shim restores the expected behaviour.
if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
  });
}

// jsdom doesn't implement scrollIntoView, which the Combobox calls when keyboard
// navigation moves the active option.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom lacks ResizeObserver, which Recharts' ResponsiveContainer instantiates.
// A no-op is enough: charts simply render at zero size in tests.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserver;
}

// jsdom doesn't implement pointer-capture APIs that Radix UI components call
// during pointer interactions (e.g. Toast, Dialog). Without these, clicking
// Radix components throws "target.hasPointerCapture is not a function".
const elProto = Element.prototype as unknown as Record<string, unknown>;
for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
  if (typeof elProto[method] !== "function") {
    elProto[method] = method === "hasPointerCapture" ? () => false : () => {};
  }
}

// jsdom doesn't implement matchMedia, which the useTheme hook needs.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (q: string) =>
    ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList),
});
