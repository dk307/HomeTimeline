import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { api } from "./client";

const BASE = "/api/v1";

describe("api client", () => {
  it("GET resolves the parsed JSON body", async () => {
    server.use(http.get(`${BASE}/thing`, () => HttpResponse.json({ a: 1 })));
    await expect(api.get("/thing")).resolves.toEqual({ a: 1 });
  });

  it("GET forwards an AbortSignal and rejects once it is aborted", async () => {
    server.use(
      http.get(`${BASE}/slow`, async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({ ok: true });
      }),
    );
    const controller = new AbortController();
    const promise = api.get("/slow", controller.signal);
    controller.abort();
    // An aborted fetch rejects (React Query treats this as a cancellation, not an error).
    await expect(promise).rejects.toThrow();
  });

  it("returns undefined for a 204 No Content response", async () => {
    server.use(http.delete(`${BASE}/thing/1`, () => new HttpResponse(null, { status: 204 })));
    await expect(api.delete("/thing/1")).resolves.toBeUndefined();
  });

  it("throws with the server-provided `detail` on an error status", async () => {
    server.use(
      http.get(`${BASE}/boom`, () => HttpResponse.json({ detail: "kaboom" }, { status: 400 })),
    );
    await expect(api.get("/boom")).rejects.toThrow("kaboom");
  });

  it("falls back to 'Request failed' when the error body has no detail", async () => {
    server.use(http.get(`${BASE}/boom`, () => HttpResponse.json({}, { status: 500 })));
    await expect(api.get("/boom")).rejects.toThrow("Request failed");
  });

  it("throws (does not hang) when the error body isn't JSON", async () => {
    server.use(
      http.get(`${BASE}/boom`, () => new HttpResponse("<html>500</html>", { status: 502 })),
    );
    await expect(api.get("/boom")).rejects.toBeInstanceOf(Error);
  });

  it("POST sends JSON content-type and a serialized body", async () => {
    let seen: { method: string; contentType: string | null; body: unknown } | undefined;
    server.use(
      http.post(`${BASE}/things`, async ({ request }) => {
        seen = {
          method: request.method,
          contentType: request.headers.get("content-type"),
          body: await request.json(),
        };
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );

    await expect(api.post("/things", { name: "cam" })).resolves.toEqual({ id: 1 });
    expect(seen).toEqual({
      method: "POST",
      contentType: "application/json",
      body: { name: "cam" },
    });
  });

  it("POST with no body omits the request payload", async () => {
    let hadBody = true;
    server.use(
      http.post(`${BASE}/trigger`, async ({ request }) => {
        hadBody = request.body !== null;
        return HttpResponse.json({ status: "ok" });
      }),
    );
    await api.post("/trigger");
    expect(hadBody).toBe(false);
  });

  it("PATCH uses the PATCH method and serializes the body", async () => {
    let method = "";
    let body: unknown;
    server.use(
      http.patch(`${BASE}/things/1`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: 1, notes: "hi" });
      }),
    );
    await api.patch("/things/1", { notes: "hi" });
    expect(method).toBe("PATCH");
    expect(body).toEqual({ notes: "hi" });
  });
});
