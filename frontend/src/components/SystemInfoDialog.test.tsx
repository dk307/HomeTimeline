import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import { SystemInfoDialog } from "@/components/SystemInfoDialog";

const MOCK_SYSTEM_INFO = {
  components: {
    app: "0.8.0",
    python: "3.14.0",
    fastapi: "0.115.0",
    uvicorn: "0.34.0",
    peewee: "3.18.0",
    go2rtc: "1.9.14",
    node: "26",
  },
  build: {
    git_sha: "abc1234",
    build_time: "2026-07-25T12:00:00Z",
    arch: "aarch64",
  },
  system: {
    os: "Linux-6.1.0",
    kernel: "6.1.0",
    sqlite: "3.45.0",
    python_impl: "CPython 64-bit",
    hwaccels: ["v4l2m2m"],
    hw_available: { v4l2m2m: true, vaapi: false, nvenc: false, qsv: false, videotoolbox: false, cuda: false },
    cpu_features: ["neon", "sve"],
  },
  ffmpeg: {
    version: "6.1.1",
    build_date: "built with gcc 12.2.0",
    config: "autodetect runtime",
    encoders: ["libx264", "libx265"],
    decoders: ["h264", "hevc"],
    hw_encoders: ["h264_v4l2m2m"],
    hw_decoders: ["h264_v4l2m2m"],
  },
  storage: {
    recordings_path: "/recordings",
    disk_free_gb: 120.0,
    disk_total_gb: 500.0,
    db_size_mb: 45.2,
    thumbnail_count: 1234,
    thumbnail_size_mb: 2300.0,
  },
};

function mockSystemInfo(data = MOCK_SYSTEM_INFO) {
  server.use(http.get("/api/v1/system_info", () => HttpResponse.json(data)));
}

describe("<SystemInfoDialog />", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("does not render when closed", () => {
    mockSystemInfo();
    renderWithClient(<SystemInfoDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("System Information")).not.toBeInTheDocument();
  });

  it("renders when open and shows loading state", () => {
    mockSystemInfo();
    renderWithClient(<SystemInfoDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByText("System Information")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("loads and displays system info on default tab", async () => {
    mockSystemInfo();
    renderWithClient(<SystemInfoDialog open={true} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    expect(screen.getByText("3.14.0")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("1.9.14")).toBeInTheDocument();
    expect(screen.getByText("aarch64")).toBeInTheDocument();
  });

  it("displays FFmpeg info on FFmpeg tab", async () => {
    mockSystemInfo();
    renderWithClient(<SystemInfoDialog open={true} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("tab", { name: /FFmpeg/ }));
    expect(screen.getByText("6.1.1")).toBeInTheDocument();
    expect(screen.getByText("libx264")).toBeInTheDocument();
  });

  it("displays storage info on Storage tab", async () => {
    mockSystemInfo();
    renderWithClient(<SystemInfoDialog open={true} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("tab", { name: /Storage/ }));
    expect(screen.getByText("120 GB")).toBeInTheDocument();
    expect(screen.getByText("45.2 MB")).toBeInTheDocument();
  });

  it("shows tabs for all four sections", async () => {
    mockSystemInfo();
    renderWithClient(<SystemInfoDialog open={true} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /App & Build/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /System/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /FFmpeg/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Storage/ })).toBeInTheDocument();
  });

  it("renders error state when API fails", async () => {
    server.use(http.get("/api/v1/system_info", () => HttpResponse.json(null, { status: 500 })));
    renderWithClient(<SystemInfoDialog open={true} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("Failed to load system info")).toBeInTheDocument();
    });
  });
});
