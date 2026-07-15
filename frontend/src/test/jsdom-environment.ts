import { builtinEnvironments } from "vitest/environments";
import type { Environment } from "vitest/environments";

const jsdomEnv = builtinEnvironments.jsdom;

/**
 * Custom vitest jsdom environment that fixes two Node 26 incompatibilities:
 *
 * 1. **AbortSignal**: Node's native `fetch()` requires `AbortSignal` instances
 *    from its own realm. Vitest's jsdom setup copies jsdom's `AbortController`
 *    onto globalThis (it's in the KEYS allow-list), but `fetch` stays native.
 *    This cross-realm mismatch makes `fetch({ signal })` throw a TypeError.
 *    Fix: restore Node's native AbortController/AbortSignal after jsdom setup.
 *
 * 2. **localStorage**: Node 26+ adds an undefined `localStorage` to globalThis.
 *    Vitest's `populateGlobal` skips keys already present in global, so jsdom's
 *    working localStorage never gets installed. Fix: copy it from jsdom's window.
 */
const environment: Environment = {
  name: "jsdom",
  transformMode: "web",
  async setup(global, options) {
    // Save Node's native versions before populateGlobal overwrites them.
    const NativeAbortController = globalThis.AbortController;
    const NativeAbortSignal = globalThis.AbortSignal;

    // Delegate to the built-in jsdom environment (creates JSDOM, calls
    // populateGlobal which copies window props onto globalThis).
    const result = await jsdomEnv.setup(global, options);

    // Restore native AbortController/AbortSignal so Node's native fetch()
    // and test-framework AbortSignals are from the same realm.
    for (const [key, value] of [
      ["AbortController", NativeAbortController],
      ["AbortSignal", NativeAbortSignal],
    ] as const) {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    }

    // Node 26's globalThis.localStorage exists but is undefined.
    // populateGlobal excluded it (not in KEYS allow-list + already "in global").
    // Copy jsdom's working instance.
    const jsdomStorage = global.jsdom?.window?.localStorage;
    if (jsdomStorage && typeof global.localStorage?.clear !== "function") {
      Object.defineProperty(global, "localStorage", {
        value: jsdomStorage,
        writable: true,
        configurable: true,
      });
    }

    return result;
  },
};

export default environment;
