import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import VideoPlayer from "./index";

describe("VideoPlayer", () => {
  it("wires the stream and download URLs for the recording", async () => {
    server.use(
      http.get("/api/v1/recordings/7", () =>
        HttpResponse.json({
          id: 7,
          camera_id: 1,
          file_path: "/x.mp4",
          start_time: "2024-01-01T10:00:00Z",
          end_time: null,
          duration_secs: 90,
          file_size_bytes: null,
          thumbnail_path: null,
          notes: null,
          status: "ready",
          created_at: "",
        }),
      ),
    );
    const { container } = renderWithClient(<VideoPlayer recordingId={7} onClose={() => {}} />);

    expect(screen.getByText("Recording #7")).toBeInTheDocument();
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/api/v1/recordings/7/stream");
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "href",
      "/api/v1/recordings/7/download",
    );

    // Metadata line appears once the query resolves.
    expect(await screen.findByText(/· 1m 30s/)).toBeInTheDocument();
  });

  it("invokes the onClose handler when the close button is clicked", async () => {
    server.use(http.get("/api/v1/recordings/3", () => new HttpResponse(null, { status: 404 })));
    const onClose = vi.fn();
    const { container } = renderWithClient(<VideoPlayer recordingId={3} onClose={onClose} />);

    // The close button is the icon-only button (the other control is the download link).
    const closeBtn = container.querySelector("button")!;
    await userEvent.click(closeBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
