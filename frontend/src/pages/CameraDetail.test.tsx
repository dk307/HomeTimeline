import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import CameraDetail from "./CameraDetail";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

function camera(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Garage", description: null, camera_type: "generic", location_id: null,
    recording_path: "/g", enabled: true, display_order: 0, clip_strategy: "daily_folder",
    scan_interval_minutes: null, host: null, username: null, download_interval_minutes: null,
    has_password: false, last_downloaded_at: null, created_at: "", updated_at: "", ...over,
  };
}

function stats(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Garage", enabled: true, total_recordings: 5, total_duration_secs: 3600,
    indexed_size_bytes: 1024, last_video_at: null, last_downloaded_at: null, ...over,
  };
}

function mockCommon(cams: ReturnType<typeof camera>[], st: ReturnType<typeof stats>) {
  server.use(
    settingsUTC,
    http.get("/api/v1/cameras", () => HttpResponse.json(cams)),
    http.get("/api/v1/cameras/:id/stats", () => HttpResponse.json(st)),
    http.get("/api/v1/cameras/:id/scan-status", () => HttpResponse.json({ running: false })),
    http.get("/api/v1/cameras/:id/download-status", () => HttpResponse.json({ running: false, last_downloaded_at: null })),
    http.get("/api/v1/cameras/:id/streams", () => HttpResponse.json({ available: false, reason: "go2rtc not configured" })),
    http.get("/api/v1/recordings/daily-counts", () => HttpResponse.json([])),
    http.get("/api/v1/timeline", () => HttpResponse.json([])),
  );
}

function renderAt(id: string) {
  return renderWithClient(
    <MemoryRouter initialEntries={[`/cameras/${id}`]}>
      <Routes>
        <Route path="/cameras/:id" element={<CameraDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CameraDetail", () => {
  it("renders the header, stat cards and generic live-view notice", async () => {
    mockCommon([camera()], stats());
    renderAt("1");

    expect(await screen.findByRole("heading", { name: "Garage" })).toBeInTheDocument();
    expect(screen.getByText("Total Recordings")).toBeInTheDocument();
    expect(
      screen.getByText("Live view is available for Hikvision cameras only."),
    ).toBeInTheDocument();
  });

  it("shows a not-found state for a non-numeric id", async () => {
    server.use(settingsUTC, http.get("/api/v1/cameras", () => HttpResponse.json([])));
    renderAt("not-a-number");
    expect(await screen.findByText("Camera not found.")).toBeInTheDocument();
  });

  it("switches to the Details tab (generic message)", async () => {
    mockCommon([camera()], stats());
    renderAt("1");
    await screen.findByRole("heading", { name: "Garage" });

    await userEvent.click(screen.getByRole("tab", { name: /Details/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/Device details are available for Hikvision cameras/),
      ).toBeInTheDocument(),
    );
  });

  it("shows Hikvision-only live view + Last Downloaded stat", async () => {
    mockCommon([camera({ camera_type: "hikvision" })], stats({ last_downloaded_at: "2024-01-01T00:00:00Z" }));
    renderAt("1");

    expect(await screen.findByRole("heading", { name: "Garage" })).toBeInTheDocument();
    // LiveView renders the "unavailable" reason from the streams query.
    expect(await screen.findByText("go2rtc not configured")).toBeInTheDocument();
    expect(screen.getByText("Last Downloaded")).toBeInTheDocument();
  });
});
