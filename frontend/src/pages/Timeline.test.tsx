import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import { useUIStore } from "@/store/ui";
import Timeline from "./Timeline";

const cameras = [{ id: 1, name: "Garage", description: "", recording_path: "/g", enabled: true }];

// A segment 2 days ago, inside the default (last 7 days) window.
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
const segments = [
  {
    camera_id: 1,
    camera_name: "Garage",
    recording_id: 99,
    start_time: twoDaysAgo.toISOString(),
    end_time: new Date(twoDaysAgo.getTime() + 3_600_000).toISOString(),
    duration_secs: 3600,
    thumbnail_path: null,
    status: "ready",
  },
];

function mock(cams: unknown[] = cameras, segs: unknown[] = segments) {
  server.use(
    http.get("/api/v1/cameras", () => HttpResponse.json(cams)),
    http.get("/api/v1/timeline", () => HttpResponse.json(segs)),
    http.get("/api/v1/recordings/:id", ({ params }) =>
      HttpResponse.json({
        id: Number(params.id), camera_id: 1, file_path: "/x.mp4", start_time: twoDaysAgo.toISOString(),
        end_time: null, duration_secs: 3600, file_size_bytes: null, thumbnail_path: null,
        notes: null, status: "ready", created_at: "",
      }),
    ),
  );
}

beforeEach(() => {
  // The UI store is a module-level singleton; reset the fields this page reads.
  useUIStore.setState({ selectedDate: undefined, selectedRecordingId: null });
});

describe("Timeline", () => {
  it("renders the heading and a lane per enabled camera", async () => {
    mock();
    renderWithClient(<Timeline />);
    expect(screen.getByRole("heading", { name: "Timeline" })).toBeInTheDocument();
    expect(await screen.findByText("Garage")).toBeInTheDocument();
  });

  it("opens the player when a segment is clicked and closes it again", async () => {
    mock();
    renderWithClient(<Timeline />);
    const seg = await screen.findByTitle(/\d{2}\/\d{2} \d{2}:\d{2}/);

    await userEvent.click(seg);
    expect(await screen.findByText("Recording #99")).toBeInTheDocument();

    // Clicking the same segment again clears the selection.
    await userEvent.click(seg);
    await waitFor(() => expect(screen.queryByText("Recording #99")).not.toBeInTheDocument());
  });

  it("shows the empty state when no cameras are configured", async () => {
    mock([], []);
    renderWithClient(<Timeline />);
    expect(await screen.findByText("No cameras configured.")).toBeInTheDocument();
  });
});
