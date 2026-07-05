import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Cameras from "./Cameras";

const cameras = [
  { id: 1, name: "Garage", description: "", recording_path: "/nas/garage", enabled: true },
  { id: 2, name: "Backyard", description: "rear fence", recording_path: "/nas/back", enabled: false },
];

const stats = {
  indexed_recordings: 0,
  indexed_size_bytes: 0,
  indexed_duration_secs: 0,
  last_scan_finished: null,
  cameras: [
    { id: 1, name: "Garage", enabled: true, recordings: 12, indexed_duration_secs: 3600, indexed_size_bytes: 1024, latest_video_at: null },
  ],
};

function mock(cams: unknown[]) {
  server.use(
    http.get("/api/v1/cameras", () => HttpResponse.json(cams)),
    http.get("/api/v1/storage/stats", () => HttpResponse.json(stats)),
  );
}

describe("Cameras page", () => {
  it("renders a card per camera, linking to its detail route", async () => {
    mock(cameras);
    const { container } = renderWithClient(
      <MemoryRouter>
        <Cameras />
      </MemoryRouter>,
    );

    const garage = await screen.findAllByText("Garage");
    expect(garage.length).toBeGreaterThan(0);
    const links = container.querySelectorAll("a");
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/cameras/1");
    expect(hrefs).toContain("/cameras/2");
  });

  it("joins storage stats onto the matching camera and defaults the rest to zero", async () => {
    mock(cameras);
    renderWithClient(
      <MemoryRouter>
        <Cameras />
      </MemoryRouter>,
    );
    // Garage has 12 recordings from stats.
    expect(await screen.findByText("12 clips")).toBeInTheDocument();
    // Backyard has no stats entry → falls back to "0 clips".
    expect(screen.getByText("0 clips")).toBeInTheDocument();
    // Missing description falls back to the recording path.
    expect(screen.getByText("/nas/garage")).toBeInTheDocument();
    expect(screen.getByText("rear fence")).toBeInTheDocument();
  });

  it("shows the empty state when no cameras are configured", async () => {
    mock([]);
    renderWithClient(
      <MemoryRouter>
        <Cameras />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No cameras configured yet.")).toBeInTheDocument();
  });
});
