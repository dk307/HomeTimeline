import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { locationsApi } from "./locations";

describe("locationsApi hits the right method + path", () => {
  it("list GETs /locations", async () => {
    let method = "";
    server.use(
      http.get("/api/v1/locations", ({ request }) => {
        method = request.method;
        return HttpResponse.json([{ id: 1, name: "Front", description: null, created_at: "" }]);
      }),
    );
    await expect(locationsApi.list()).resolves.toHaveLength(1);
    expect(method).toBe("GET");
  });

  it("create POSTs to /locations with the body", async () => {
    let method = "";
    let body: unknown;
    server.use(
      http.post("/api/v1/locations", async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: 2 });
      }),
    );
    await locationsApi.create({ name: "Garage", description: "side" });
    expect(method).toBe("POST");
    expect(body).toMatchObject({ name: "Garage", description: "side" });
  });

  it("update PATCHes the id-scoped resource", async () => {
    let method = "";
    let body: unknown;
    server.use(
      http.patch("/api/v1/locations/5", async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: 5 });
      }),
    );
    await locationsApi.update(5, { name: "Renamed" });
    expect(method).toBe("PATCH");
    expect(body).toMatchObject({ name: "Renamed" });
  });

  it("delete DELETEs the id-scoped resource", async () => {
    let method = "";
    server.use(
      http.delete("/api/v1/locations/9", ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await locationsApi.delete(9);
    expect(method).toBe("DELETE");
  });
});
