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

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("date-range-trigger"));
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

  it("shows default 30-day range in the trigger", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    const trigger = await screen.findByTestId("date-range-trigger");
    expect(trigger).toHaveTextContent("Last 30 days");
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

  it("changes range when a preset is selected from dropdown", async () => {
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
    await screen.findByTestId("date-range-trigger");
    expect(receivedDays).toBe("30");

    // Open popover and choose "Last 7 days"
    const user = userEvent.setup();
    await openPopover(user);
    await user.click(screen.getByRole("option", { name: "Last 7 days" }));

    await waitFor(() => expect(receivedDays).toBe("7"));
  });

  it("shows calendar after selecting Custom range in popover", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Recordings activity");

    const user = userEvent.setup();
    await openPopover(user);

    // Click "Custom range…" option
    await user.click(screen.getByRole("option", { name: /Custom range/ }));

    // Calendar should be visible (RangeCalendar renders grid roles)
    await waitFor(() => {
      expect(screen.getAllByRole("grid").length).toBeGreaterThan(0);
    });
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

  it("selects presets from dropdown", async () => {
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
    await screen.findByTestId("date-range-trigger");

    const user = userEvent.setup();

    // Open and select 7d
    await openPopover(user);
    await user.click(screen.getByRole("option", { name: "Last 7 days" }));
    await waitFor(() => expect(receivedDays).toBe("7"));

    // Open and select 90d
    await openPopover(user);
    await user.click(screen.getByRole("option", { name: "Last 90 days" }));
    await waitFor(() => expect(receivedDays).toBe("90"));
  });

  it("opens calendar via Custom range and selects a day range", async () => {
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
    await screen.findByText("Recordings activity");

    const user = userEvent.setup();
    await openPopover(user);

    // Switch to calendar view
    await user.click(screen.getByRole("option", { name: /Custom range/ }));

    // Find calendar day buttons and click two of them to form a range
    const dayButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("td[role='gridcell'] button")).filter(
      (el) => !el.disabled,
    );
    // Click two non-adjacent days to form a range
    if (dayButtons.length >= 5) {
      await user.click(dayButtons[2]);
      await user.click(dayButtons[4]);

      // Click Apply
      await user.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(receivedDays).not.toBeNull());
    }
  });

  it("closes popover on outside click", async () => {
    mockDailyCounts([]);
    renderWithClient(<RecordingsChart />);
    await screen.findByText("Recordings activity");

    const user = userEvent.setup();
    await openPopover(user);

    // Options should be visible
    await waitFor(() => {
      expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    });

    // Click outside the popover (on the heading)
    await user.click(screen.getByText("Recordings activity"));
    // Popover should close
    await waitFor(() => {
      expect(screen.queryAllByRole("option").length).toBe(0);
    });
  });
});
