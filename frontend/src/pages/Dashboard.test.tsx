import { describe, it, expect } from "vitest";
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

function mock(opts: { running?: boolean; cameras?: unknown[] } = {}) {
  const s = { ...stats, cameras: opts.cameras ?? stats.cameras };
  server.use(
    settingsUTC,
    http.get("/api/v1/storage/stats", () => HttpResponse.json(s)),
    http.get("/api/v1/recordings/daily-counts", () => HttpResponse.json([])),
    http.get("/api/v1/scanner/status", () =>
      HttpResponse.json({ running: opts.running ?? false, last_run: null, last_result: null }),
    ),
  );
}

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

  it("triggers a scan when 'Scan Now' is clicked", async () => {
    mock();
    let scanned = false;
    server.use(
      http.post("/api/v1/scanner/scan", () => {
        scanned = true;
        return HttpResponse.json({ status: "started" });
      }),
    );
    renderWithClient(<Dashboard />);

    const btn = await screen.findByRole("button", { name: /Scan Now/ });
    await userEvent.click(btn);
    await waitFor(() => expect(scanned).toBe(true));
  });

  it("disables the scan button and shows 'Scanning...' while a scan is running", async () => {
    mock({ running: true });
    renderWithClient(<Dashboard />);
    const btn = await screen.findByRole("button", { name: /Scanning/ });
    expect(btn).toBeDisabled();
  });

  it("shows an empty note when no cameras are configured", async () => {
    mock({ cameras: [] });
    renderWithClient(<Dashboard />);
    expect(await screen.findByText("No cameras configured yet.")).toBeInTheDocument();
  });
});
