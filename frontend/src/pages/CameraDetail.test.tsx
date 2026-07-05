import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import CameraDetail from "./CameraDetail";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

// ── WebRTC / media stubs so LiveView's <VideoStream> can mount ────────────────
class FakeWS {
  static OPEN = 1;
  readyState = 1;
  send() {}
  close() {}
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  constructor(public url: string) {}
}
class FakePC {
  connectionState = "new";
  addTransceiver() {}
  createOffer() { return Promise.resolve({ type: "offer", sdp: "v=0" }); }
  setLocalDescription() { return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  addIceCandidate() { return Promise.resolve(); }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWS);
  vi.stubGlobal("RTCPeerConnection", FakePC);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function camera(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Garage", description: null, camera_type: "generic", location_id: null,
    recording_path: "/g", enabled: true, display_order: 0, clip_strategy: "daily_folder",
    scan_interval_minutes: null, host: null, username: null, download_interval_minutes: null,
    purge_older_than_days: null, purge_interval_minutes: null,
    has_password: false, last_downloaded_at: null, last_purged_at: null, created_at: "", updated_at: "", ...over,
  };
}
function stats(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Garage", enabled: true, total_recordings: 5, total_duration_secs: 3600,
    indexed_size_bytes: 1024, last_video_at: null, last_downloaded_at: null, ...over,
  };
}

interface Opts {
  segments?: unknown[];
  scanRunning?: boolean;
  downloadRunning?: boolean;
  purgeRunning?: boolean;
  streams?: unknown;
  deviceInfo?: unknown;
}

function mockCommon(cams: ReturnType<typeof camera>[], st: ReturnType<typeof stats>, o: Opts = {}) {
  server.use(
    settingsUTC,
    http.get("/api/v1/cameras", () => HttpResponse.json(cams)),
    http.get("/api/v1/cameras/:id/stats", () => HttpResponse.json(st)),
    http.get("/api/v1/cameras/:id/scan-status", () => HttpResponse.json({ running: o.scanRunning ?? false })),
    http.get("/api/v1/cameras/:id/download-status", () => HttpResponse.json({ running: o.downloadRunning ?? false, last_downloaded_at: null })),
    http.get("/api/v1/cameras/:id/purge-status", () => HttpResponse.json({ running: o.purgeRunning ?? false, last_purged_at: null })),
    http.get("/api/v1/cameras/:id/streams", () => HttpResponse.json(o.streams ?? { available: false, reason: "go2rtc not configured" })),
    http.get("/api/v1/cameras/:id/device-info", () => HttpResponse.json(o.deviceInfo ?? { available: false })),
    http.get("/api/v1/recordings/daily-counts", () => HttpResponse.json([])),
    http.get("/api/v1/timeline", () => HttpResponse.json(o.segments ?? [])),
    http.get("/api/v1/recordings/:id", ({ params }) =>
      HttpResponse.json({
        id: Number(params.id), camera_id: 1, file_path: "/x.mp4", start_time: "2024-01-01T00:00:00Z",
        end_time: null, duration_secs: 60, file_size_bytes: null, thumbnail_path: null, notes: null,
        status: "ready", created_at: "",
      }),
    ),
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

describe("CameraDetail — page shell", () => {
  it("renders the header, stat cards and generic live-view notice", async () => {
    mockCommon([camera()], stats());
    renderAt("1");
    expect(await screen.findByRole("heading", { name: "Garage" })).toBeInTheDocument();
    expect(screen.getByText("Total Recordings")).toBeInTheDocument();
    expect(screen.getByText("Live view is available for Hikvision cameras only.")).toBeInTheDocument();
  });

  it("shows a not-found state for a non-numeric id", async () => {
    server.use(settingsUTC, http.get("/api/v1/cameras", () => HttpResponse.json([])));
    renderAt("not-a-number");
    expect(await screen.findByText("Camera not found.")).toBeInTheDocument();
  });

  it("offers a camera switcher when more than one camera exists", async () => {
    mockCommon([camera(), camera({ id: 2, name: "Door" })], stats());
    renderAt("1");
    const select = await screen.findByRole("combobox", { name: "Switch camera" });
    expect(select).toHaveValue("1");
    // Selecting another camera navigates → useParams updates the controlled value.
    await userEvent.selectOptions(select, "2");
    await waitFor(() => expect(select).toHaveValue("2"));
  });
});

describe("CameraDetail — timeline tab", () => {
  it("shows the empty timeline message when there are no segments", async () => {
    mockCommon([camera()], stats(), { segments: [] });
    renderAt("1");
    expect(await screen.findByText("No recordings in this range.")).toBeInTheDocument();
  });

  it("opens the player when a timeline segment is clicked", async () => {
    mockCommon([camera()], stats(), {
      segments: [
        {
          camera_id: 1, camera_name: "Garage", recording_id: 42,
          start_time: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          end_time: new Date(Date.now() - 2 * 86_400_000 + 3_600_000).toISOString(),
          duration_secs: 3600, thumbnail_path: null, status: "ready",
        },
      ],
    });
    renderAt("1");
    const seg = await screen.findByTitle(/\d{2}\/\d{2} \d{2}:\d{2}/);
    await userEvent.click(seg);
    expect(await screen.findByText("Recording #42")).toBeInTheDocument();
  });
});

describe("CameraDetail — scan control", () => {
  it("triggers a scan from the header Scan button", async () => {
    mockCommon([camera()], stats(), { scanRunning: false });
    let scanned = false;
    server.use(http.post("/api/v1/cameras/1/scan", () => { scanned = true; return HttpResponse.json({ status: "started", camera: "Garage" }); }));
    renderAt("1");
    await userEvent.click(await screen.findByRole("button", { name: "Scan" }));
    await waitFor(() => expect(scanned).toBe(true));
  });

  it("shows a Stop button while a scan is running", async () => {
    mockCommon([camera()], stats(), { scanRunning: true });
    renderAt("1");
    expect(await screen.findByRole("button", { name: /Stop Scan/ })).toBeInTheDocument();
  });
});

describe("CameraDetail — commands tab", () => {
  it("reindexes and drops the index after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockCommon([camera()], stats());
    let reindexed = false, dropped = false;
    server.use(
      http.post("/api/v1/cameras/1/reindex", () => { reindexed = true; return HttpResponse.json({ status: "ok", camera: "Garage" }); }),
      http.delete("/api/v1/cameras/1/recordings", () => { dropped = true; return HttpResponse.json({ deleted: 3 }); }),
    );
    renderAt("1");
    await screen.findByRole("heading", { name: "Garage" });

    await userEvent.click(screen.getByRole("tab", { name: /Commands/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Reindex/ }));
    await waitFor(() => expect(reindexed).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: /Drop Index/ }));
    await waitFor(() => expect(dropped).toBe(true));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it("aborts the command when confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockCommon([camera()], stats());
    let reindexed = false;
    server.use(http.post("/api/v1/cameras/1/reindex", () => { reindexed = true; return HttpResponse.json({ status: "ok", camera: "Garage" }); }));
    renderAt("1");
    await screen.findByRole("heading", { name: "Garage" });
    await userEvent.click(screen.getByRole("tab", { name: /Commands/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Reindex/ }));
    // Give any (unexpected) request a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(reindexed).toBe(false);
  });
});

describe("CameraDetail — Hikvision extras", () => {
  const hik = () => camera({ camera_type: "hikvision" });

  it("renders the download control and triggers a download", async () => {
    mockCommon([hik()], stats({ last_downloaded_at: "2024-01-01T00:00:00Z" }));
    let downloaded = false;
    server.use(http.post("/api/v1/cameras/1/download", () => { downloaded = true; return HttpResponse.json({ status: "started", camera: "Garage" }); }));
    renderAt("1");
    expect(await screen.findByText("Last Downloaded")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Download Videos/ }));
    await waitFor(() => expect(downloaded).toBe(true));
  });

  it("purges old videos after confirmation when a retention age is set", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockCommon([camera({ camera_type: "hikvision", purge_older_than_days: 30 })], stats());
    let purged = false;
    server.use(http.post("/api/v1/cameras/1/purge", () => { purged = true; return HttpResponse.json({ status: "started", camera: "Garage" }); }));
    renderAt("1");
    await userEvent.click(await screen.findByRole("button", { name: /Purge Old Videos/ }));
    await waitFor(() => expect(purged).toBe(true));
  });

  it("disables the purge button when no retention age is configured", async () => {
    mockCommon([hik()], stats());
    renderAt("1");
    const btn = await screen.findByRole("button", { name: /Purge Old Videos/ });
    expect(btn).toBeDisabled();
  });

  it("surfaces an error when the purge request fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockCommon([camera({ camera_type: "hikvision", purge_older_than_days: 30 })], stats());
    server.use(http.post("/api/v1/cameras/1/purge", () => new HttpResponse("boom", { status: 500 })));
    renderAt("1");
    await userEvent.click(await screen.findByRole("button", { name: /Purge Old Videos/ }));
    expect(await screen.findByText(/Purge failed/)).toBeInTheDocument();
  });

  it("shows a Stop Purge button while a purge is running", async () => {
    mockCommon([camera({ camera_type: "hikvision", purge_older_than_days: 30 })], stats(), { purgeRunning: true });
    renderAt("1");
    expect(await screen.findByRole("button", { name: /Stop Purge/ })).toBeInTheDocument();
  });

  it("shows device details on the Details tab", async () => {
    mockCommon([hik()], stats(), {
      deviceInfo: { available: true, info: { model: "DS-2CD", firmware: "V5.7" }, rtsp_url: "rtsp://cam/1" },
    });
    renderAt("1");
    await screen.findByRole("heading", { name: "Garage" });
    await userEvent.click(screen.getByRole("tab", { name: /Details/ }));
    expect(await screen.findByText("DS-2CD")).toBeInTheDocument();
    expect(screen.getByText(/rtsp:\/\/cam\/1/)).toBeInTheDocument();
  });

  it("renders the live stream picker and switches quality", async () => {
    mockCommon([hik()], stats(), {
      streams: {
        available: true,
        streams: [
          { quality: "sub", name: "cam_sub", label: "SD" },
          { quality: "main", name: "cam_main", label: "HD" },
        ],
      },
    });
    const { container } = renderAt("1");
    // The quality toggle exposes both stream labels.
    expect(await screen.findByRole("button", { name: "HD" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "HD" }));
    // A <video> element is mounted by VideoStream for the selected stream.
    await waitFor(() => expect(container.querySelector("video")).toBeInTheDocument());
  });
});
