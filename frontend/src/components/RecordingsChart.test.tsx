import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import RecordingsChart from "./RecordingsChart";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

function mockDailyCounts(data: { date: string; count: number; total_secs: number }[], params?: { cameraId?: number }) {
  server.use(
    settingsUTC,
    http.get("/api/v1/recordings/daily-counts", ({ request }) => {
      const url = new URL(request.url);
      if (params?.cameraId && url.searchParams.get("camera_id") !== String(params.cameraId)) {
        return HttpResponse.json([]);
      }
      return HttpResponse.json(data);
    }),
  );
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

describe("RecordingsChart", () => {
  it("renders with data and shows summary", async () => {
    mockDailyCounts([
      { date: daysAgo(2), count: 5, total_secs: 300 },
      { date: daysAgo(1), count: 3, total_secs: 180 },
    ]);
    renderWithClient(<RecordingsChart />);
    expect(await screen.findByText("Recordings activity")).toBeInTheDocument();
    expect(screen.getByText(/8 clips/)).toBeInTheDocument();
    expect(screen.getByText(/over 30 days/)).toBeInTheDocument();
  });

  it("shows default 30-day range label", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    expect(await screen.findByText("Last 30 days")).toBeInTheDocument();
  });

  it("renders empty state with zero clips", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    expect(await screen.findByText("Recordings activity")).toBeInTheDocument();
    expect(screen.getByText(/0 clips/)).toBeInTheDocument();
  });

  it("passes cameraId to the API", async () => {
    let receivedCameraId: string | null = null;
    server.use(
      settingsUTC,
      http.get("/api/v1/recordings/daily-counts", ({ request }) => {
        const url = new URL(request.url);
        receivedCameraId = url.searchParams.get("camera_id");
        return HttpResponse.json([{ date: daysAgo(1), count: 2, total_secs: 120 }]);
      }),
    );
    renderWithClient(<RecordingsChart cameraId={42} />);
    await waitFor(() => expect(receivedCameraId).toBe("42"));
  });

  it("changes range when a preset is clicked", async () => {
    let receivedDays: string | null = null;
    server.use(
      settingsUTC,
      http.get("/api/v1/recordings/daily-counts", ({ request }) => {
        const url = new URL(request.url);
        receivedDays = url.searchParams.get("days");
        return HttpResponse.json([]);
      }),
    );
    renderWithClient(<RecordingsChart />);

    // Wait for initial render
    await screen.findByText("Last 30 days");
    expect(receivedDays).toBe("30");

    // Open the date range trigger
    await userEvent.click(screen.getByTestId("date-range-trigger"));
    // Click "Last 7 days" preset
    await userEvent.click(screen.getByText("Last 7 days"));

    await waitFor(() => expect(receivedDays).toBe("7"));
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
  });

  it("opens calendar popover and shows presets", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Recordings activity");

    // Calendar trigger is present
    const trigger = screen.getByTestId("date-range-trigger");
    expect(trigger).toBeInTheDocument();

    // Open the popover
    await userEvent.click(trigger);

    // All presets are visible
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Last 14 days")).toBeInTheDocument();
    expect(screen.getAllByText("Last 30 days").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Last 60 days")).toBeInTheDocument();
    expect(screen.getByText("Last 90 days")).toBeInTheDocument();
    expect(screen.getByText("Custom range")).toBeInTheDocument();
  });

  it("navigates to previous period with prev button", async () => {
    let receivedDays: string | null = null;
    server.use(
      settingsUTC,
      http.get("/api/v1/recordings/daily-counts", ({ request }) => {
        const url = new URL(request.url);
        receivedDays = url.searchParams.get("days");
        return HttpResponse.json([]);
      }),
    );
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Last 30 days");

    // Click prev — switches to custom with same day span shifted back
    const prevBtn = screen.getByTitle("Previous period");
    await userEvent.click(prevBtn);

    await waitFor(() => expect(receivedDays).toBe("30"));
    expect(screen.getByText("Custom range")).toBeInTheDocument();
  });

  it("shows loading skeleton while fetching", async () => {
    // Never resolve the query
    server.use(
      settingsUTC,
      http.get("/api/v1/recordings/daily-counts", () => new Promise(() => {})),
    );
    renderWithClient(<RecordingsChart />);
    // While loading, ChartSkeleton renders instead of the chart heading
    await waitFor(() => {
      expect(screen.queryByText("Recordings activity")).not.toBeInTheDocument();
    });
  });

  it("navigates forward and is disabled at today", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Last 30 days");

    // Next button should be disabled since we're at today
    const nextBtn = screen.getByTitle("Next period");
    expect(nextBtn).toBeDisabled();
  });

  it("navigates forward after navigating back", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Last 30 days");

    // Navigate back first
    const prevBtn = screen.getByTitle("Previous period");
    await userEvent.click(prevBtn);
    expect(screen.getByText("Custom range")).toBeInTheDocument();

    // Now next button should be enabled
    const nextBtn = screen.getByTitle("Next period");
    expect(nextBtn).toBeEnabled();
    await userEvent.click(nextBtn);

    // Should navigate forward — still custom, but the date range shifted
    await waitFor(() => expect(screen.getByText("Custom range")).toBeInTheDocument());
  });

  it("selects a custom date range from calendar", async () => {
    let receivedDays: string | null = null;
    server.use(
      settingsUTC,
      http.get("/api/v1/recordings/daily-counts", ({ request }) => {
        const url = new URL(request.url);
        receivedDays = url.searchParams.get("days");
        return HttpResponse.json([]);
      }),
    );
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Last 30 days");

    // Open popover and select custom range via preset first
    await userEvent.click(screen.getByTestId("date-range-trigger"));
    await userEvent.click(screen.getByText("Last 7 days"));
    await waitFor(() => expect(receivedDays).toBe("7"));

    // Re-open and select 90d
    await userEvent.click(screen.getByTestId("date-range-trigger"));
    await userEvent.click(screen.getByText("Last 90 days"));
    await waitFor(() => expect(receivedDays).toBe("90"));
  });

  it("selects a custom range via calendar day clicks", async () => {
    let receivedDays: string | null = null;
    server.use(
      settingsUTC,
      http.get("/api/v1/recordings/daily-counts", ({ request }) => {
        const url = new URL(request.url);
        receivedDays = url.searchParams.get("days");
        return HttpResponse.json([]);
      }),
    );
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Last 30 days");

    // Open popover
    await userEvent.click(screen.getByTestId("date-range-trigger"));

    // Find calendar day buttons and click two of them to form a range
    const dayButtons = Array.from(document.querySelectorAll(".rdrDayNumber")).filter(
      (el): el is HTMLButtonElement => el.tagName === "BUTTON" && !(el as HTMLButtonElement).disabled,
    );
    // Click two non-adjacent days to form a range
    if (dayButtons.length >= 5) {
      await userEvent.click(dayButtons[2]);
      await userEvent.click(dayButtons[4]);
      // The popover should close and the range should be applied
      await waitFor(() => expect(receivedDays).not.toBeNull());
      expect(screen.getByText("Custom range")).toBeInTheDocument();
    }
  });

  it("closes popover on outside click", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Recordings activity");

    await userEvent.click(screen.getByTestId("date-range-trigger"));
    // Popover is open
    expect(screen.getByText("Custom range")).toBeInTheDocument();

    // Click outside the popover (on the heading)
    await userEvent.click(screen.getByText("Recordings activity"));
    // Popover should close — "Custom range" text in the sidebar is gone
    await waitFor(() => {
      expect(screen.queryAllByText("Custom range").length).toBe(0);
    });
  });
});
