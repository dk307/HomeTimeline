import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
  { id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true },
  { id: 2, name: "Backyard", camera_type: "hikvision", host: "10.0.0.6", enabled: true },
  // Not live-capable: generic, and hikvision-without-host — both excluded.
  { id: 3, name: "Attic", camera_type: "generic", host: null, enabled: true },
  { id: 4, name: "NoHost", camera_type: "hikvision", host: "", enabled: true },
];

function streamsFor(id: number) {
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

  it("shows only live-capable cameras and defaults to their sub streams", async () => {
    mock();
    renderLive();

    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(2));
    const names = screen
      .getAllByTestId("stream")
      .map((s) => s.getAttribute("data-name"))
      .sort();
    expect(names).toEqual(["cam1_sub", "cam2_sub"]);
    // Excluded cameras don't render a tile.
    expect(screen.queryByText("Attic")).not.toBeInTheDocument();
  });

  it("switches every tile to the main stream when quality changes", async () => {
    mock();
    renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(2));

    await userEvent.click(screen.getByRole("button", { name: "main" }));
    const names = screen
      .getAllByTestId("stream")
      .map((s) => s.getAttribute("data-name"))
      .sort();
    expect(names).toEqual(["cam1_main", "cam2_main"]);
  });

  it("applies the chosen cameras-per-row layout to the grid", async () => {
    mock();
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(2));

    const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']")!;
    // Two cameras, Auto → near-square (2 columns).
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");

    await userEvent.click(screen.getByRole("button", { name: "1×" }));
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });

  it("links each tile to its camera detail page", async () => {
    mock();
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByTestId("stream")).toHaveLength(2));

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/cameras/1");
    expect(hrefs).toContain("/cameras/2");
  });

  it("shows an empty state when no camera supports live view", async () => {
    mock([{ id: 3, name: "Attic", camera_type: "generic", host: null, enabled: true }]);
    renderLive();
    expect(
      await screen.findByText(/No live-capable cameras/),
    ).toBeInTheDocument();
  });

  it("renders a per-tile unavailable message when streams can't be prepared", async () => {
    server.use(
      http.get("/api/v1/cameras", () =>
        HttpResponse.json([
          { id: 1, name: "Garage", camera_type: "hikvision", host: "10.0.0.5", enabled: true },
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
});
