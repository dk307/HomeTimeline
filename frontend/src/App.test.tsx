import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import App from "./App";

// App mounts BrowserRouter and defaults to "/" → Dashboard, so its queries must
// be mocked for the smoke render to settle.
function mockDashboard() {
  server.use(
    http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" })),
    http.get("/api/v1/storage/stats", () =>
      HttpResponse.json({ indexed_recordings: 0, indexed_size_bytes: 0, indexed_duration_secs: 0, last_scan_finished: null, cameras: [] }),
    ),
    http.get("/api/v1/recordings/daily-counts", () => HttpResponse.json([])),
    http.get("/api/v1/scanner/status", () => HttpResponse.json({ running: false, last_run: null, last_result: null })),
    http.get("/api/v1/cameras/download-all/status", () => HttpResponse.json({ running: false, available: false })),
    http.get("/api/v1/cameras/purge-all/status", () => HttpResponse.json({ running: false, available: false })),
  );
}

describe("App shell", () => {
  it("renders the sidebar nav and the default Dashboard route", async () => {
    mockDashboard();
    renderWithClient(<App />);

    expect(screen.getByText("Camera Manager")).toBeInTheDocument();
    // Sidebar links route to each screen.
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/timeline");
    expect(screen.getByRole("link", { name: "Recordings" })).toHaveAttribute("href", "/recordings");
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/settings/general");
    // Default route renders the Dashboard heading.
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});
