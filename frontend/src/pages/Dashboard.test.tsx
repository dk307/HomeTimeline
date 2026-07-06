import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Dashboard from "./Dashboard";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

const stats = {
  indexed_recordings: 42,
  indexed_size_bytes: 1024 * 1024,
  indexed_duration_secs: 3661,
  last_scan_finished: null,
  cameras: [
    { id: 1, name: "Garage", enabled: true, recordings: 42, indexed_duration_secs: 3661, indexed_size_bytes: 1024 * 1024, latest_video_at: null },
  ],
};

interface MockOpts {
  running?: boolean;
  cameras?: unknown[];
  downloadAvailable?: boolean;
  downloadRunning?: boolean;
  purgeAvailable?: boolean;
  purgeRunning?: boolean;
}

function mock(opts: MockOpts = {}) {
  const s = { ...stats, cameras: opts.cameras ?? stats.cameras };
  server.use(
    settingsUTC,
    http.get("/api/v1/storage/stats", () => HttpResponse.json(s)),
    http.get("/api/v1/recordings/daily-counts", () => HttpResponse.json([])),
    http.get("/api/v1/scanner/status", () =>
      HttpResponse.json({ running: opts.running ?? false, last_run: null, last_result: null }),
    ),
    http.get("/api/v1/cameras/download-all/status", () =>
      HttpResponse.json({ running: opts.downloadRunning ?? false, available: opts.downloadAvailable ?? false }),
    ),
    http.get("/api/v1/cameras/purge-all/status", () =>
      HttpResponse.json({ running: opts.purgeRunning ?? false, available: opts.purgeAvailable ?? false }),
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard", () => {
  it("renders the storage stat cards", async () => {
    mock();
    renderWithClient(<Dashboard />);
    // Wait for data-dependent content (the cameras table row) before asserting.
    expect(await screen.findByText("Garage")).toBeInTheDocument();
    // Stat card labels (these titles are unique to the cards; the table uses
    // shorter headers like "Recordings" / "Indexed Size").
    expect(screen.getByText("Total Recordings")).toBeInTheDocument();
    expect(screen.getByText("Total Clip Length")).toBeInTheDocument();
    // The 42 count shows on both the card and the cameras table row.
    expect(screen.getAllByText("42").length).toBeGreaterThanOrEqual(1);
  });

  it("triggers a disk scan when 'Scan Disk' is clicked", async () => {
    mock();
    let scanned = false;
    server.use(
      http.post("/api/v1/scanner/scan", () => {
        scanned = true;
        return HttpResponse.json({ status: "started" });
      }),
    );
    renderWithClient(<Dashboard />);

    const btn = await screen.findByRole("button", { name: /Scan Disk/ });
    await userEvent.click(btn);
    await waitFor(() => expect(scanned).toBe(true));
  });

  it("disables Download/Purge Videos when no camera supports them", async () => {
    mock({ downloadAvailable: false, purgeAvailable: false });
    renderWithClient(<Dashboard />);
    expect(await screen.findByRole("button", { name: /Download Videos/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Purge Videos/ })).toBeDisabled();
  });

  it("triggers a bulk download when Download Videos is available and clicked", async () => {
    mock({ downloadAvailable: true });
    let triggered = false;
    server.use(
      http.post("/api/v1/cameras/download-all", () => {
        triggered = true;
        return HttpResponse.json({ status: "started" });
      }),
    );
    renderWithClient(<Dashboard />);
    const btn = await screen.findByRole("button", { name: /Download Videos/ });
    await waitFor(() => expect(btn).toBeEnabled()); // wait for the status query
    await userEvent.click(btn);
    await waitFor(() => expect(triggered).toBe(true));
  });

  it("triggers a bulk purge (after confirm) when Purge Videos is available", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mock({ purgeAvailable: true });
    let triggered = false;
    server.use(
      http.post("/api/v1/cameras/purge-all", () => {
        triggered = true;
        return HttpResponse.json({ status: "started" });
      }),
    );
    renderWithClient(<Dashboard />);
    const btn = await screen.findByRole("button", { name: /Purge Videos/ });
    await waitFor(() => expect(btn).toBeEnabled()); // wait for the status query
    await userEvent.click(btn);
    await waitFor(() => expect(triggered).toBe(true));
  });

  it("surfaces an error when a bulk download request fails", async () => {
    mock({ downloadAvailable: true });
    server.use(
      http.post("/api/v1/cameras/download-all", () => new HttpResponse("boom", { status: 500 })),
    );
    renderWithClient(<Dashboard />);
    const btn = await screen.findByRole("button", { name: /Download Videos/ });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(await screen.findByText(/Download failed/)).toBeInTheDocument();
  });

  it("shows progress labels while bulk actions run", async () => {
    mock({ downloadAvailable: true, downloadRunning: true, purgeAvailable: true, purgeRunning: true });
    renderWithClient(<Dashboard />);
    expect(await screen.findByRole("button", { name: /Downloading/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Purging/ })).toBeDisabled();
  });

  it("disables the scan button and shows 'Scanning...' while a scan is running", async () => {
    mock({ running: true });
    renderWithClient(<Dashboard />);
    const btn = await screen.findByRole("button", { name: /Scanning/ });
    expect(btn).toBeDisabled();
  });

  it("summarizes the last completed scan", async () => {
    mock();
    server.use(
      http.get("/api/v1/scanner/status", () =>
        HttpResponse.json({ running: false, last_run: "2024-01-01T00:00:00Z", last_result: { camA: 2, camB: 1 } }),
      ),
    );
    renderWithClient(<Dashboard />);
    expect(await screen.findByText(/Last scan completed/)).toBeInTheDocument();
    expect(screen.getByText(/3 new recordings/)).toBeInTheDocument();
  });

  it("shows an empty note when no cameras are configured", async () => {
    mock({ cameras: [] });
    renderWithClient(<Dashboard />);
    expect(await screen.findByText("No cameras configured yet.")).toBeInTheDocument();
  });
});
