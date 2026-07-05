import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { makeTestQueryClient } from "@/test/utils";
import { useTimezone } from "./useTimezone";

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useTimezone", () => {
  it("falls back to UTC before the settings query resolves", () => {
    server.use(http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "America/Chicago" })));
    const { result } = renderHook(() => useTimezone(), { wrapper });
    // First synchronous render: data is still undefined → the "UTC" fallback.
    expect(result.current).toBe("UTC");
  });

  it("returns the configured timezone once settings load", async () => {
    server.use(http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "Asia/Tokyo" })));
    const { result } = renderHook(() => useTimezone(), { wrapper });
    await waitFor(() => expect(result.current).toBe("Asia/Tokyo"));
  });

  it("keeps the UTC fallback when the settings request fails", async () => {
    server.use(http.get("/api/v1/settings", () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useTimezone(), { wrapper });
    // Give the failing query a tick; the fallback must hold.
    await waitFor(() => expect(result.current).toBe("UTC"));
  });
});
