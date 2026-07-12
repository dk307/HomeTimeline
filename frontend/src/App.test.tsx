import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("collapses and expands the sidebar when the toggle button is clicked", async () => {
    localStorage.clear();
    mockDashboard();
    renderWithClient(<App />);

    // Initially expanded — text labels visible
    expect(screen.getByText("Camera Manager")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();

    // Click collapse button
    const toggleBtn = screen.getByRole("button", { name: "Collapse sidebar" });
    await userEvent.click(toggleBtn);

    // Collapsed — text labels hidden, expand button shown
    expect(screen.queryByText("Camera Manager")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
    expect(localStorage.getItem("sidebar-collapsed")).toBe("true");

    // Click expand button
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    // Expanded again
    expect(screen.getByText("Camera Manager")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
  });

  it("restores collapsed state from localStorage", () => {
    localStorage.setItem("sidebar-collapsed", "true");
    mockDashboard();
    renderWithClient(<App />);

    expect(screen.queryByText("Camera Manager")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });
});
