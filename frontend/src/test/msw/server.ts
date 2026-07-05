import { setupServer } from "msw/node";

// Tests register their own handlers via `server.use(...)`, so the base server
// starts empty. Combined with `onUnhandledRequest: "error"` (see setup.ts), this
// forces every test to declare exactly which requests it expects.
export const server = setupServer();
