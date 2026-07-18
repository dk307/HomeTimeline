import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { recordingsApi, timelineApi } from "./recordings";

/** Register a handler for `path` and resolve with the query params of the request
 *  the code-under-test actually sends. */
function captureQuery(path: string, body: unknown[] = []) {
  return new Promise<URLSearchParams>((resolve) => {
    server.use(
      http.get(path, ({ request }) => {
        resolve(new URL(request.url).searchParams);
        return HttpResponse.json(body);
      }),
    );
  });
}

describe("recordingsApi.list query building", () => {
  it("includes only the params that are set", async () => {
    const q = captureQuery("/api/v1/recordings");
    await recordingsApi.list({ camera_id: 5, date: "2024-05-01", status: "indexed" });
    const params = await q;
    expect(params.get("camera_id")).toBe("5");
    expect(params.get("date")).toBe("2024-05-01");
    expect(params.get("status")).toBe("indexed");
    expect(params.has("days")).toBe(false);
  });

  it("drops a single-day span but keeps multi-day", async () => {
    const q1 = captureQuery("/api/v1/recordings");
    await recordingsApi.list({ days: 1 });
    expect((await q1).has("days")).toBe(false);

    const q7 = captureQuery("/api/v1/recordings");
    await recordingsApi.list({ days: 7 });
    expect((await q7).get("days")).toBe("7");
  });

  it("omits a falsy camera_id (0) rather than sending camera_id=0", async () => {
    const q = captureQuery("/api/v1/recordings");
    await recordingsApi.list({ camera_id: 0 });
    expect((await q).has("camera_id")).toBe(false);
  });

  it("includes limit and offset params when provided", async () => {
    const q = captureQuery("/api/v1/recordings");
    await recordingsApi.list({ limit: 50, offset: 100 });
    const params = await q;
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("100");
  });
});

describe("recordingsApi.dailyCounts query building", () => {
  it("always sends days and adds camera_id only when truthy", async () => {
    const q = captureQuery("/api/v1/recordings/daily-counts");
    await recordingsApi.dailyCounts(14, 3);
    const params = await q;
    expect(params.get("days")).toBe("14");
    expect(params.get("camera_id")).toBe("3");
  });

  it("defaults to 30 days and omits camera_id when not given", async () => {
    const q = captureQuery("/api/v1/recordings/daily-counts");
    await recordingsApi.dailyCounts();
    const params = await q;
    expect(params.get("days")).toBe("30");
    expect(params.has("camera_id")).toBe(false);
  });
});

describe("timelineApi.get query building", () => {
  it("joins multiple camera ids with commas", async () => {
    const q = captureQuery("/api/v1/timeline");
    await timelineApi.get("2024-05-01", 7, [1, 2, 3]);
    const params = await q;
    expect(params.get("date")).toBe("2024-05-01");
    expect(params.get("days")).toBe("7");
    expect(params.get("camera_ids")).toBe("1,2,3");
  });

  it("omits camera_ids for an empty array", async () => {
    const q = captureQuery("/api/v1/timeline");
    await timelineApi.get("2024-05-01", 1, []);
    expect((await q).has("camera_ids")).toBe(false);
  });
});

describe("recordingsApi url builders", () => {
  it("build stream and download urls without a request", () => {
    expect(recordingsApi.streamUrl(12)).toBe("/api/v1/recordings/12/stream");
    expect(recordingsApi.downloadUrl(12)).toBe("/api/v1/recordings/12/download");
  });
});
