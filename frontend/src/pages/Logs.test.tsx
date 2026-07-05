import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Logs from "./Logs";

// useTimezone (used for the "Updated" clock + row timestamps) reads /settings.
const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

const ENTRIES = [
  { ts: "2024-01-01T00:00:00Z", level: "INFO", logger: "app.startup", msg: "oldest" },
  { ts: "2024-01-01T01:00:00Z", level: "ERROR", logger: "app.scan", msg: "newest" },
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
    expect(firstData.getByText("newest")).toBeInTheDocument();
    expect(firstData.getByText("ERROR")).toBeInTheDocument();
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
    await screen.findByText("newest");
    expect(lastLevel).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "ERROR" }));
    await waitFor(() => expect(lastLevel).toBe("ERROR"));
  });
});
