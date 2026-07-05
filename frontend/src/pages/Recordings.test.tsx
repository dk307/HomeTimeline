import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Recordings from "./Recordings";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

const cameras = [
  { id: 1, name: "Garage", description: "", recording_path: "/g", enabled: true },
  { id: 2, name: "Backyard", description: "", recording_path: "/b", enabled: true },
];

// id 1 (Garage) is older but longer; id 2 (Backyard) is newer but shorter — so
// sorting by time vs. duration produces different row orders.
const recordings = [
  { id: 1, camera_id: 1, file_path: "/1.mp4", start_time: "2024-01-01T10:00:00Z", end_time: null, duration_secs: 120, file_size_bytes: 2000, thumbnail_path: null, notes: null, status: "ready", created_at: "" },
  { id: 2, camera_id: 2, file_path: "/2.mp4", start_time: "2024-01-02T10:00:00Z", end_time: null, duration_secs: 60, file_size_bytes: 1000, thumbnail_path: null, notes: null, status: "processing", created_at: "" },
];

function mock(recs: unknown[] = recordings, opts: { captureList?: (u: URL) => void } = {}) {
  server.use(
    settingsUTC,
    http.get("/api/v1/cameras", () => HttpResponse.json(cameras)),
    http.get("/api/v1/recordings/:id", ({ params }) =>
      HttpResponse.json({ ...recordings[0], id: Number(params.id) }),
    ),
    http.get("/api/v1/recordings", ({ request }) => {
      opts.captureList?.(new URL(request.url));
      return HttpResponse.json(recs);
    }),
  );
}

function dataRows(): HTMLElement[] {
  // All <tr> minus the header row.
  return screen.getAllByRole("row").slice(1);
}

describe("Recordings", () => {
  it("renders a row per recording with the camera name joined in", async () => {
    mock();
    renderWithClient(<Recordings />);
    expect(await screen.findByText("Garage")).toBeInTheDocument();
    expect(screen.getByText("Backyard")).toBeInTheDocument();
  });

  it("shows the empty state when there are no recordings", async () => {
    mock([]);
    renderWithClient(<Recordings />);
    expect(await screen.findByText("No recordings found.")).toBeInTheDocument();
  });

  it("defaults to the 'Last 7 days' preset and requests days=7", async () => {
    let captured: URL | undefined;
    mock(recordings, { captureList: (u) => (captured = u) });
    renderWithClient(<Recordings />);
    await screen.findByText("Garage");
    expect(captured?.searchParams.get("days")).toBe("7");
    expect(captured?.searchParams.get("date")).toBeTruthy();
  });

  it("re-sorts when a sortable column header is clicked", async () => {
    mock();
    renderWithClient(<Recordings />);
    await screen.findByText("Garage");

    // Default sort: start_time desc → newest (Backyard) first.
    expect(within(dataRows()[0]).getByText("Backyard")).toBeInTheDocument();

    // Sort by Duration (desc) → longest (Garage, 120s) first.
    await userEvent.click(screen.getByText(/Duration/));
    await waitFor(() => expect(within(dataRows()[0]).getByText("Garage")).toBeInTheDocument());
  });

  it("flags a non-ready recording with a status warning", async () => {
    mock();
    renderWithClient(<Recordings />);
    await screen.findByText("Backyard");
    expect(screen.getByTitle("Status: processing")).toBeInTheDocument();
  });

  it("opens the inline player when a row's Play button is clicked", async () => {
    mock();
    renderWithClient(<Recordings />);
    await screen.findByText("Garage");

    await userEvent.click(screen.getAllByTitle("Play")[0]);
    // The player header shows the selected recording id.
    expect(await screen.findByText(/Recording #/)).toBeInTheDocument();
  });

  it("toggles sort direction when the same column header is clicked twice", async () => {
    mock();
    renderWithClient(<Recordings />);
    await screen.findByText("Garage");

    // First Duration click → desc (longest, Garage, first).
    await userEvent.click(screen.getByText(/Duration/));
    await waitFor(() => expect(within(dataRows()[0]).getByText("Garage")).toBeInTheDocument());
    // Second click flips to asc (shortest, Backyard, first).
    await userEvent.click(screen.getByText(/Duration/));
    await waitFor(() => expect(within(dataRows()[0]).getByText("Backyard")).toBeInTheDocument());
    // Switching to Size sorts by file_size_bytes desc (Garage, 2000, first).
    await userEvent.click(screen.getByText(/Size/));
    await waitFor(() => expect(within(dataRows()[0]).getByText("Garage")).toBeInTheDocument());
  });

  it("renders a thumbnail and plays the recording when it is clicked", async () => {
    const withThumb = [{ ...recordings[0], thumbnail_path: "/thumbs/a.jpg" }];
    mock(withThumb);
    const { container } = renderWithClient(<Recordings />);
    await screen.findByText("Garage");

    const img = container.querySelector('img[src="/thumbnails/a.jpg"]') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    await userEvent.click(img);
    expect(await screen.findByText(/Recording #/)).toBeInTheDocument();
  });

  it("applies a preset from the date-range picker", async () => {
    mock();
    renderWithClient(<Recordings />);
    await screen.findByText("Garage");

    await userEvent.click(screen.getByTestId("date-range-trigger"));
    await userEvent.click(await screen.findByRole("button", { name: "Today" }));
    // The trigger now reflects the chosen preset.
    await waitFor(() => expect(screen.getByTestId("date-range-trigger")).toHaveTextContent("Today"));
  });
});
