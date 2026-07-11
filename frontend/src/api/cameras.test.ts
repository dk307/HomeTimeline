import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { camerasApi } from "./cameras";

describe("camerasApi.list", () => {
  it("omits the enabled filter when no argument is passed", async () => {
    let url = "";
    server.use(
      http.get("/api/v1/cameras", ({ request }) => {
        url = request.url;
        return HttpResponse.json([]);
      }),
    );
    await camerasApi.list();
    expect(new URL(url).searchParams.has("enabled")).toBe(false);
  });

  it.each([true, false])("passes enabled=%s through as a query param", async (enabled) => {
    let value: string | null = null;
    server.use(
      http.get("/api/v1/cameras", ({ request }) => {
        value = new URL(request.url).searchParams.get("enabled");
        return HttpResponse.json([]);
      }),
    );
    await camerasApi.list(enabled);
    expect(value).toBe(String(enabled));
  });
});

describe("camerasApi mutations hit the right method + path", () => {
  it("create POSTs to /cameras with the body", async () => {
    let method = "";
    let body: unknown;
    server.use(
      http.post("/api/v1/cameras", async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: 1 });
      }),
    );
    await camerasApi.create({ name: "Front", recording_path: "/rec" });
    expect(method).toBe("POST");
    expect(body).toMatchObject({ name: "Front", recording_path: "/rec" });
  });

  it("create Aqura camera sends Aqura fields", async () => {
    let body: unknown;
    server.use(
      http.post("/api/v1/cameras", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 2 });
      }),
    );
    await camerasApi.create({
      name: "Aqura Cam",
      recording_path: "/nas/aqura",
      camera_type: "aqura",
      stream_url_1: "rtsp://10.0.0.1:554/1",
      stream_url_2: "rtsp://10.0.0.1:554/2",
      stream_url_3: "rtsp://10.0.0.1:554/3",
      aqura_username: "admin",
      aqura_password: "secret",
    });
    expect(body).toMatchObject({
      name: "Aqura Cam",
      camera_type: "aqura",
      stream_url_1: "rtsp://10.0.0.1:554/1",
      stream_url_2: "rtsp://10.0.0.1:554/2",
      stream_url_3: "rtsp://10.0.0.1:554/3",
      aqura_username: "admin",
      aqura_password: "secret",
    });
  });

  it("dropIndex DELETEs the recordings sub-resource", async () => {
    let method = "";
    server.use(
      http.delete("/api/v1/cameras/7/recordings", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ deleted: 3 });
      }),
    );
    await expect(camerasApi.dropIndex(7)).resolves.toEqual({ deleted: 3 });
    expect(method).toBe("DELETE");
  });

  it("scan POSTs to the camera-scoped scan endpoint", async () => {
    let hit = false;
    server.use(
      http.post("/api/v1/cameras/42/scan", () => {
        hit = true;
        return HttpResponse.json({ status: "started", camera: "Front" });
      }),
    );
    await camerasApi.scan(42);
    expect(hit).toBe(true);
  });
});
