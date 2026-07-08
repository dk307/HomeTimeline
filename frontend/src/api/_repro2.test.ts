import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { api } from "./client";

describe("repro2 direct", () => {
  it("resolves with a NON-aborted signal", async () => {
    server.use(http.get("/api/v1/p", () => HttpResponse.json({ v: 7 })));
    const c = new AbortController();
    await expect(api.get("/p", c.signal)).resolves.toEqual({ v: 7 });
  });
  it("resolves with NO signal", async () => {
    server.use(http.get("/api/v1/p", () => HttpResponse.json({ v: 7 })));
    await expect(api.get("/p")).resolves.toEqual({ v: 7 });
  });
});
