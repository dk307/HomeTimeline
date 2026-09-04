import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Live from "./Live";

// VideoStream opens a real WebSocket/RTCPeerConnection; in the wall we only care
// about which stream name each tile mounts, so stub it out.
vi.mock("@/components/VideoStream", () => ({
  default: ({ streamName }: { streamName: string }) => (
    <div data-testid="stream" data-name={streamName} />
  ),
}));

const cameras = [
  { id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
  { id: 2, name: "Backyard", camera_type: "hikvision", host: "10.0.0.6", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
  // Not live-capable: hikvision-without-host and aqura-without-stream-url — excluded.
  { id: 3, name: "Attic", camera_type: "aqura", host: null, enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
  { id: 4, name: "NoHost", camera_type: "hikvision", host: "", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
  // Live-capable: aqura with a stream URL.
  { id: 5, name: "Doorbell", camera_type: "aqura", host: null, enabled: true, stream_url_1: "rtsp://10.0.0.7:554/1", stream_url_2: "rtsp://10.0.0.7:554/2", stream_url_3: "rtsp://10.0.0.7:554/3" },
];

function streamsFor(id: number) {
  if (id === 5) {
    return {
      available: true,
      streams: [
        { quality: "1", name: "cam5_1", label: "Channel1" },
        { quality: "2", name: "cam5_2", label: "Channel2" },
        { quality: "3", name: "cam5_3", label: "Channel3" },
      ],
    };
  }
  return {
    available: true,
    streams: [
      { quality: "main", name: `cam${id}_main`, label: "Main (HD)" },
      { quality: "sub", name: `cam${id}_sub`, label: "Sub (SD)" },
    ],
  };
}

function mock(cams: unknown[] = cameras) {
  server.use(
    http.get("/api/v1/cameras", () => HttpResponse.json(cams)),
    http.get("/api/v1/cameras/:id/streams", ({ params }) =>
      HttpResponse.json(streamsFor(Number(params.id))),
    ),
  );
}

function renderLive() {
  return renderWithClient(
    <MemoryRouter>
      <Live />
    </MemoryRouter>,
  );
}

describe("Live wall", () => {
  // The layout choice is persisted to localStorage; keep tests independent.
  beforeEach(() => localStorage.clear());

  // jsdom's default innerWidth is 1024, which under the width-based auto layout
  // yields 3 columns. Pin it to a known value so auto-column assertions are
  // deterministic instead of depending on the jsdom default.
  const ORIGINAL_INNER_WIDTH = window.innerWidth;
  function setWidth(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  }
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: ORIGINAL_INNER_WIDTH,
    });
  });

  it("shows only live-capable cameras, including Aqura, and defaults to each camera's first stream", async () => {
    mock();
    renderLive();

    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));
    const names = screen
      .getAllByTestId("stream")
      .map((s) => s.getAttribute("data-name"))
      .sort();
    // Hikvision cameras default to "main" (first stream), Aqura to "Channel1".
    expect(names).toEqual(["cam1_main", "cam2_main", "cam5_1"]);
    // Excluded cameras don't render a tile.
    expect(screen.queryByText("Attic")).not.toBeInTheDocument();
    expect(screen.queryByText("NoHost")).not.toBeInTheDocument();
  });

  it("each tile has a per-camera stream selector", async () => {
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    // Each tile with multiple streams gets a combobox trigger.
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(3);
  });

  it("switching the stream on one tile does not affect others", async () => {
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    // Find the Garage tile's select (first Hikvision camera) and switch to "sub".
    const selects = screen.getAllByRole("combobox");
    await userEvent.click(selects[0]);
    await userEvent.click(await screen.findByRole("option", { name: "Sub (SD)" }));

    const names = screen
      .getAllByTestId("stream")
      .map((s) => s.getAttribute("data-name"))
      .sort();
    expect(names).toEqual(["cam1_sub", "cam2_main", "cam5_1"]);
  });

  it("applies the chosen cameras-per-row layout to the grid", async () => {
    setWidth(800); // < 1024 → auto uses 2 columns
    mock();
    const { container, unmount } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    // Three cameras, Auto at 800px → 2 columns.
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");

    await userEvent.click(screen.getByRole("radio", { name: "1×" }));
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");

    // The choice is persisted and restored on a fresh mount (loadLayout).
    unmount();
    const { container: container2 } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));
    const grid2 = container2.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    expect(grid2.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });

  it("restores a persisted 'auto' layout on mount", async () => {
    setWidth(800); // < 1024 → auto uses 2 columns
    localStorage.setItem("liveWall.layout", "auto");
    mock();
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));
    const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    // Auto with three cameras at 800px → 2 columns.
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  });

  it("auto layout adapts to a narrower viewport via the resize listener", async () => {
    setWidth(1100); // tablet → 3 columns
    mock();
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));
    const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");

    // Narrow to a phone width and fire resize — the same mounted Live must reflow
    // (exercises the resize listener, not just initial layout calc).
    setWidth(375); // phone
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))"),
    );
  });

  it("auto layout uses four columns on a wide screen with enough cameras", async () => {
    setWidth(1500);
    mock([
      { id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
      { id: 2, name: "Backyard", camera_type: "hikvision", host: "10.0.0.6", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
      { id: 3, name: "Attic", camera_type: "hikvision", host: "10.0.0.7", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
      { id: 4, name: "Driveway", camera_type: "hikvision", host: "10.0.0.8", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
      { id: 5, name: "Doorbell", camera_type: "hikvision", host: "10.0.0.9", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
    ]);
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(5));
    const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    // Auto at 1500px → 4 columns (clamped to the 5 cameras).
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("honours a manual layout on mobile (2× still applies at a narrow width)", async () => {
    setWidth(375); // phone — previously forced to a single column
    mock();
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    await userEvent.click(screen.getByRole("radio", { name: "2×" }));
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("hides the layout control when only one camera is live-capable", async () => {
    mock([{ id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null }]);
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(1));
    // Column count is clamped to 1 with a single camera, so the toggle-group
    // radios are a no-op and shouldn't be shown.
    expect(screen.queryByRole("radio", { name: "Auto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "2×" })).not.toBeInTheDocument();
  });

  it("shows the layout control once more than one camera is live-capable", async () => {
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));
    expect(screen.getByRole("radio", { name: "Auto" })).toBeInTheDocument();
  });

  it("links each tile to its camera detail page", async () => {
    mock();
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/cameras/1");
    expect(hrefs).toContain("/cameras/2");
    expect(hrefs).toContain("/cameras/5");
  });

  it("shows an empty state when no camera supports live view", async () => {
    mock([{ id: 3, name: "Attic", camera_type: "aqura", host: null, enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null }]);
    renderLive();
    expect(
      await screen.findByText(/No live-capable cameras/),
    ).toBeInTheDocument();
  });

  it("renders a per-tile unavailable message when streams can't be prepared", async () => {
    server.use(
      http.get("/api/v1/cameras", () =>
        HttpResponse.json([
          { id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
        ]),
      ),
      http.get("/api/v1/cameras/:id/streams", () =>
        HttpResponse.json({ available: false, reason: "Live streaming service is not running" }),
      ),
    );
    renderLive();
    expect(
      await screen.findByText("Live streaming service is not running"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stream")).not.toBeInTheDocument();
  });

  it("falls back to a generic message when a failed stream fetch gives no reason", async () => {
    server.use(
      http.get("/api/v1/cameras", () =>
        HttpResponse.json([
          { id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true, stream_url_1: null, stream_url_2: null, stream_url_3: null },
        ]),
      ),
      // Network failure → the query errors with no `reason` payload.
      http.get("/api/v1/cameras/:id/streams", () => HttpResponse.error()),
    );
    renderLive();
    expect(await screen.findByText("Live view unavailable")).toBeInTheDocument();
  });

  it("persists channel selection to localStorage when changed", async () => {
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    const selects = screen.getAllByRole("combobox");
    await userEvent.click(selects[0]);
    await userEvent.click(await screen.findByRole("option", { name: "Sub (SD)" }));

    expect(localStorage.getItem("liveWall.channel.1")).toBe("sub");
  });

  it("restores a persisted channel selection on mount", async () => {
    localStorage.setItem("liveWall.channel.1", "sub");
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    // Camera 1 (Garage) should show the sub stream, not the default main.
    const names = screen
      .getAllByTestId("stream")
      .map((s) => s.getAttribute("data-name"))
      .sort();
    expect(names).toEqual(["cam1_sub", "cam2_main", "cam5_1"]);
  });

  it("falls back to the first stream when stored channel is no longer valid", async () => {
    // Store a quality that doesn't exist in the returned streams.
    localStorage.setItem("liveWall.channel.1", "nonexistent");
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(3));

    // Camera 1 (Garage) should default to "main" (first stream).
    const names = screen
      .getAllByTestId("stream")
      .map((s) => s.getAttribute("data-name"))
      .sort();
    expect(names).toEqual(["cam1_main", "cam2_main", "cam5_1"]);
  });
});