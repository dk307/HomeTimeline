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
    renderWithClient(<VideoPlayer recordingId={3} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("shows no prev/next controls when navigation handlers are absent", () => {
    server.use(http.get("/api/v1/recordings/1", () => new HttpResponse(null, { status: 404 })));
    renderWithClient(<VideoPlayer recordingId={1} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Previous clip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next clip" })).not.toBeInTheDocument();
  });

  it("renders a position counter and steps with the prev/next buttons", async () => {
    server.use(http.get("/api/v1/recordings/2", () => new HttpResponse(null, { status: 404 })));
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderWithClient(
      <VideoPlayer
        recordingId={2}
        onClose={() => {}}
        onPrev={onPrev}
        onNext={onNext}
        position={{ index: 2, total: 3 }}
      />,
    );

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next clip" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous clip" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("disables the edge control when only one direction is available", () => {
    server.use(http.get("/api/v1/recordings/5", () => new HttpResponse(null, { status: 404 })));
    renderWithClient(<VideoPlayer recordingId={5} onClose={() => {}} onNext={() => {}} />);
    // At the first clip: prev present but disabled, next enabled.
    expect(screen.getByRole("button", { name: "Previous clip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next clip" })).toBeEnabled();
  });

  it("navigates with the left/right arrow keys", async () => {
    server.use(http.get("/api/v1/recordings/2", () => new HttpResponse(null, { status: 404 })));
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderWithClient(
      <VideoPlayer recordingId={2} onClose={() => {}} onPrev={onPrev} onNext={onNext} />,
    );

    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("renders a fullscreen toggle button", () => {
    server.use(http.get("/api/v1/recordings/1", () => new HttpResponse(null, { status: 404 })));
    renderWithClient(<VideoPlayer recordingId={1} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
  });

  it("toggles fullscreen state on button click", async () => {
    server.use(http.get("/api/v1/recordings/1", () => new HttpResponse(null, { status: 404 })));
    const { container } = renderWithClient(<VideoPlayer recordingId={1} onClose={() => {}} />);
    const video = container.querySelector("video")!;

    const reqFs = vi.fn().mockResolvedValue(undefined);
    const exitFs = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, "requestFullscreen", { value: reqFs, configurable: true });
    Object.defineProperty(document, "exitFullscreen", { value: exitFs, configurable: true });

    // Enter fullscreen
    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(reqFs).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();

    // Simulate the browser firing fullscreenchange
    document.dispatchEvent(new Event("fullscreenchange"));

    // Exit fullscreen
    await userEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(exitFs).toHaveBeenCalled();
  });

  it("ignores arrow keys while a form field is focused", async () => {
    server.use(http.get("/api/v1/recordings/2", () => new HttpResponse(null, { status: 404 })));
    const onNext = vi.fn();
    renderWithClient(<VideoPlayer recordingId={2} onClose={() => {}} onNext={onNext} />);

    // Focus a text field (e.g. a notes input elsewhere on the page) — arrow keys
    // should reach it, not steal focus for clip navigation.
    const input = document.body.appendChild(document.createElement("input"));
    try {
      input.focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(onNext).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it("ignores arrow keys while the date-picker calendar has focus", async () => {
    server.use(http.get("/api/v1/recordings/2", () => new HttpResponse(null, { status: 404 })));
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderWithClient(
      <VideoPlayer recordingId={2} onClose={() => {}} onPrev={onPrev} onNext={onNext} />,
    );

    // react-day-picker owns ←/→ to move between day buttons; our calendar wrapper
    // carries the `.ht-cal` class. A focused day button inside it must not step clips.
    const cal = document.body.appendChild(document.createElement("div"));
    cal.className = "ht-cal";
    const day = cal.appendChild(document.createElement("button"));
    try {
      day.focus();
      await userEvent.keyboard("{ArrowRight}");
      await userEvent.keyboard("{ArrowLeft}");
      expect(onNext).not.toHaveBeenCalled();
      expect(onPrev).not.toHaveBeenCalled();
    } finally {
      cal.remove();
    }
  });
});
