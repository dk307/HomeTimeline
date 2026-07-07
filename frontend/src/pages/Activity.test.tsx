import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Activity from "./Activity";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

function activity(events: unknown[]) {
  server.use(settingsUTC, http.get("/api/v1/activity", () => HttpResponse.json(events)));
}

describe("Activity", () => {
  it("shows the empty state with no events", async () => {
    activity([]);
    renderWithClient(<Activity />);
    expect(await screen.findByText("No scan or download activity yet.")).toBeInTheDocument();
  });

  it("renders a completed scan with duration and a 'new' badge", async () => {
    activity([
      {
        type: "scan",
        id: 1,
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:05Z",
        status: "ok",
        detail: null,
        new_recordings: 3,
        cameras_scanned: 2,
      },
    ]);
    renderWithClient(<Activity />);

    expect(await screen.findByText("Scan complete")).toBeInTheDocument();
    expect(screen.getByText("+3 new")).toBeInTheDocument();
    // calcDuration(0s → 5s) formats as "5.0s".
    expect(screen.getByText("5.0s")).toBeInTheDocument();
  });

  it("renders a download event with its camera and downloaded badge", async () => {
    activity([
      {
        type: "download",
        id: 9,
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:01:00Z",
        status: "ok",
        detail: null,
        camera: "Garage",
        downloaded: 4,
        indexed: 4,
      },
    ]);
    renderWithClient(<Activity />);

    expect(await screen.findByText("Download complete")).toBeInTheDocument();
    expect(screen.getByText("+4 downloaded")).toBeInTheDocument();
    expect(screen.getByText("Garage")).toBeInTheDocument();
  });

  it("renders a purge event with its camera, deleted count and freed space", async () => {
    activity([
      {
        type: "purge",
        id: 11,
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:30Z",
        status: "ok",
        detail: null,
        camera: "Attic",
        deleted: 7,
        freed_bytes: 5 * 1024 * 1024,
      },
    ]);
    renderWithClient(<Activity />);

    expect(await screen.findByText("Purge complete")).toBeInTheDocument();
    expect(screen.getByText("7 deleted")).toBeInTheDocument();
    expect(screen.getByText("5 MB freed")).toBeInTheDocument();
    expect(screen.getByText("Attic")).toBeInTheDocument();
  });

  it("flags a still-running event as stale once it is older than 15 minutes", async () => {
    const longAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    activity([
      { type: "scan", id: 2, started_at: longAgo, finished_at: null, status: "ok", detail: "stuck" },
    ]);
    renderWithClient(<Activity />);

    expect(await screen.findByText("Scan (incomplete)")).toBeInTheDocument();
    expect(screen.getByTitle("Stale — no completion recorded")).toBeInTheDocument();
  });

  it("labels an in-progress download and shows skipped counts", async () => {
    activity([
      { type: "download", id: 5, started_at: new Date().toISOString(), finished_at: null, status: "ok", detail: null, camera: "Gate" },
      { type: "scan", id: 6, started_at: "2024-01-01T00:00:00Z", finished_at: "2024-01-01T00:00:02Z", status: "ok", detail: null, skipped_recordings: 4 },
    ]);
    renderWithClient(<Activity />);
    expect(await screen.findByText("Downloading…")).toBeInTheDocument();
    expect(screen.getByText("4 already indexed")).toBeInTheDocument();
  });

  it("marks a restart-interrupted run distinctly (badge, title, amber icon)", async () => {
    activity([
      {
        type: "download",
        id: 8,
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:05:00Z",
        status: "interrupted",
        detail: "Interrupted — the service restarted before this run finished.",
        camera: "Gate",
      },
    ]);
    renderWithClient(<Activity />);

    expect(await screen.findByText("Download interrupted")).toBeInTheDocument();
    expect(screen.getByText("interrupted")).toBeInTheDocument();
    expect(screen.getByTitle("Interrupted by a service restart")).toBeInTheDocument();
  });

  it("shows an error badge and red detail for failed events", async () => {
    activity([
      {
        type: "scan",
        id: 3,
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:01Z",
        status: "error",
        detail: "boom",
      },
    ]);
    renderWithClient(<Activity />);

    const badge = await screen.findByText("error");
    expect(badge).toBeInTheDocument();
    expect(screen.getByText("boom")).toHaveClass("text-red-500");
  });
});
