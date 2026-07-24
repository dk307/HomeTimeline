import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Logs from "./Logs";

// useTimezone (used for the "Updated" clock + row timestamps) reads /settings.
const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

const ENTRIES = [
  { ts: "2024-01-01T00:00:00Z", level: "INFO", logger: "app.startup", camera_name: null, msg: "oldest" },
  { ts: "2024-01-01T01:00:00Z", level: "ERROR", logger: "app.scan", camera_name: "Garage", msg: "[Garage] newest" },
];

describe("Logs", () => {
  it("shows the empty state when there are no entries", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json([])));
    renderWithClient(<Logs />);
    expect(await screen.findByText("No log entries.")).toBeInTheDocument();
  });

  it("renders newest-first (the source list is reversed for display)", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)));
    renderWithClient(<Logs />);

    const rows = await screen.findAllByRole("row");
    // rows[0] is the header; the first data row is the newest entry.
    const firstData = within(rows[1]);
    expect(firstData.getByText(/newest/)).toBeInTheDocument();
  });

  it("passes the selected level through as a query param", async () => {
    let lastLevel: string | null = "unset";
    server.use(
      settingsUTC,
      http.get("/api/v1/logs", ({ request }) => {
        lastLevel = new URL(request.url).searchParams.get("level");
        return HttpResponse.json(ENTRIES);
      }),
    );
    renderWithClient(<Logs />);

    // Default ("ALL") sends no level filter.
    await screen.findByText(/newest/);
    expect(lastLevel).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "ERROR" }));
    await waitFor(() => expect(lastLevel).toBe("ERROR"));
  });

  it("shows camera name prepended to message", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)));
    renderWithClient(<Logs />);

    // Camera name is prepended to the message by the backend ([Garage] newest)
    expect(await screen.findByText((c) => c.includes("[Garage]"))).toBeInTheDocument();
  });

  it("shows level badges", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)));
    renderWithClient(<Logs />);

    await screen.findByText(/newest/);
    // Badges render level text (badges are <span> elements, filter buttons are <button>)
    const badges = screen.getAllByText("INFO");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges.some((el) => el.tagName === "SPAN")).toBe(true);

    const errorBadges = screen.getAllByText("ERROR");
    expect(errorBadges.length).toBeGreaterThanOrEqual(1);
    expect(errorBadges.some((el) => el.tagName === "SPAN")).toBe(true);
  });

  it("shows log count", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)));
    renderWithClient(<Logs />);

    await screen.findByText("Showing 2 of 500 entries");
  });

  it("shows empty log count when no entries", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json([])));
    renderWithClient(<Logs />);

    await screen.findByText("No log entries.");
    expect(screen.getByText("Showing 0 of 500 entries")).toBeInTheDocument();
  });

  it("toggles pause on click", async () => {
    server.use(settingsUTC, http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)));
    renderWithClient(<Logs />);

    await screen.findByText(/newest/);

    const pauseBtn = screen.getByTitle("Pause auto-refresh");
    expect(pauseBtn).toBeInTheDocument();

    await userEvent.click(pauseBtn);
    expect(screen.getByTitle("Resume auto-refresh")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Resume auto-refresh"));
    expect(screen.getByTitle("Pause auto-refresh")).toBeInTheDocument();
  });

  it("builds correct download URL", async () => {
    let downloadUrl = "";
    server.use(
      settingsUTC,
      http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)),
      http.get("/api/v1/logs/download", ({ request }) => {
        downloadUrl = request.url;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderWithClient(<Logs />);
    await screen.findByText(/newest/);

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() => expect(downloadUrl).toContain("/api/v1/logs/download"));
    expect(downloadUrl).not.toContain("level=");
    alertSpy.mockRestore();
  });

  it("includes level in download URL when filtered", async () => {
    let downloadUrl = "";
    server.use(
      settingsUTC,
      http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)),
      http.get("/api/v1/logs/download", ({ request }) => {
        downloadUrl = request.url;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderWithClient(<Logs />);
    await screen.findByText(/newest/);

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const errorBtn = screen.getByRole("button", { name: "ERROR" });
    await userEvent.click(errorBtn);
    await waitFor(() => expect(errorBtn).toHaveClass("bg-primary"));
    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() => expect(downloadUrl).toContain("level=ERROR"));
    alertSpy.mockRestore();
  });

  it("alerts on download failure", async () => {
    server.use(
      settingsUTC,
      http.get("/api/v1/logs", () => HttpResponse.json(ENTRIES)),
      http.get("/api/v1/logs/download", () => new HttpResponse(null, { status: 500 })),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithClient(<Logs />);
    await screen.findByText(/newest/);

    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toContain("Download failed");
    alertSpy.mockRestore();
  });

  it("sends search query param", async () => {
    let lastSearch: string | null = "unset";
    server.use(
      settingsUTC,
      http.get("/api/v1/logs", ({ request }) => {
        lastSearch = new URL(request.url).searchParams.get("search");
        return HttpResponse.json(ENTRIES);
      }),
    );
    renderWithClient(<Logs />);

    await screen.findByText(/newest/);

    const input = screen.getByPlaceholderText("Search messages…");
    await userEvent.type(input, "test");

    // Debounce is 300ms; wait for it
    await waitFor(() => expect(lastSearch).toBe("test"), { timeout: 1000 });
  });
});