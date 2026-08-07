import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import VideoStream from "./VideoStream";

// ── Minimal WebSocket / RTCPeerConnection stubs (jsdom ships neither) ──────────
class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = FakeWS.OPEN;
  sent: string[] = [];
  closed = false;
  onopen?: () => Promise<void> | void;
  onmessage?: (ev: { data: string }) => void;
  onerror?: () => void;
  onclose?: (ev: { wasClean: boolean }) => void;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
}

class FakePC {
  static instances: FakePC[] = [];
  connectionState = "new";
  closed = false;
  onicecandidate?: (ev: unknown) => void;
  ontrack?: (ev: unknown) => void;
  onconnectionstatechange?: () => void;
  transceivers: string[] = [];
  setRemoteDescription = vi.fn(() => Promise.resolve());
  addIceCandidate = vi.fn(() => Promise.resolve());
  getReceivers = vi.fn((): unknown[] => []);
  constructor() {
    FakePC.instances.push(this);
  }
  addTransceiver(kind: string) {
    this.transceivers.push(kind);
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "v=0" });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeWS.instances = [];
  FakePC.instances = [];
  vi.stubGlobal("WebSocket", FakeWS);
  vi.stubGlobal("RTCPeerConnection", FakePC);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  // jsdom doesn't implement srcObject; make it a plain settable property.
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    writable: true,
    value: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("VideoStream", () => {
  it("opens a same-origin signaling socket and requests recvonly tracks", () => {
    render(<VideoStream streamName="front cam" />);

    expect(screen.getByText("Connecting to live view…")).toBeInTheDocument();
    const ws = FakeWS.instances[0];
    expect(ws.url).toMatch(/^ws:\/\//);
    // The stream name is URL-encoded into the src query param.
    expect(ws.url).toContain("/api/v1/cameras/live/ws?src=front%20cam");
    expect(FakePC.instances[0].transceivers).toEqual(["video", "audio"]);
  });

  it("sends a WebRTC offer once the socket opens", async () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    await act(async () => {
      await ws.onopen?.();
    });
    expect(ws.sent.some((m) => m.includes("webrtc/offer"))).toBe(true);
  });

  it("clears the overlay once the peer connection reports 'connected'", async () => {
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });
    expect(screen.queryByText("Connecting to live view…")).not.toBeInTheDocument();
  });

  it("shows buffering once connected but before a frame renders, then plays on a frame", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });
    // Connected but no decodable frame yet → visible buffering state.
    expect(screen.getByText("Buffering live video…")).toBeInTheDocument();

    // A frame becomes available → moves to playing and clears the overlay.
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { value: 1920, configurable: true });
    Object.defineProperty(video, "readyState", { value: 2, configurable: true });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText("Buffering live video…")).not.toBeInTheDocument();
    expect(screen.queryByText("Connecting to live view…")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("retries when connected but no frame renders within the frame timeout", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });
    expect(screen.getByText("Buffering live video…")).toBeInTheDocument();

    // 10s elapse with no video data → treated as stuck → a new connection starts
    // (the frame timeout at 10s plus the 2s retry backoff).
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(FakeWS.instances.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it("shows an error after auto-retries are exhausted, then retry button works", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);

    // Fail 3 times (MAX_AUTO_RETRIES=2 means 1 initial + 2 retries = 3 attempts)
    for (let i = 0; i < 3; i++) {
      const pc = FakePC.instances[FakePC.instances.length - 1];
      await act(async () => {
        pc.connectionState = "failed";
        pc.onconnectionstatechange?.();
      });
      // Advance past retry delay (except on last failure)
      if (i < 2) {
        await act(async () => {
          vi.advanceTimersByTime(2000);
        });
      }
    }

    expect(screen.getByText("Live view unavailable")).toBeInTheDocument();

    // Click retry — resets counter and opens a new connection
    const retryBtn = screen.getByRole("button", { name: /Retry/ });
    await act(async () => {
      fireEvent.click(retryBtn);
    });
    expect(FakeWS.instances.length).toBe(4);
    vi.useRealTimers();
  });

  it("tears down the socket and peer connection on unmount", () => {
    const { unmount } = render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];
    unmount();
    expect(ws.closed).toBe(true);
    expect(pc.closed).toBe(true);
  });

  it("applies a remote answer from the signaling socket", async () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];
    await act(async () => {
      await ws.onmessage?.({ data: JSON.stringify({ type: "webrtc/answer", value: "sdpX" }) });
    });
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "sdpX" });
  });

  it("adds a remote ICE candidate from the signaling socket", async () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];
    await act(async () => {
      await ws.onmessage?.({ data: JSON.stringify({ type: "webrtc/candidate", value: "cand" }) });
    });
    expect(pc.addIceCandidate).toHaveBeenCalledWith({ candidate: "cand", sdpMid: "0" });
  });

  it("ignores malformed signaling messages", async () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];
    await act(async () => {
      await ws.onmessage?.({ data: "not-json" });
    });
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
  });

  it("forwards locally-gathered ICE candidates over the socket", () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0] as FakePC & { onicecandidate?: (e: unknown) => void };
    act(() => {
      pc.onicecandidate?.({ candidate: { candidate: "abc" } });
    });
    expect(ws.sent.some((m) => m.includes("webrtc/candidate") && m.includes("abc"))).toBe(true);
  });

  it("attaches the incoming media stream to the video element", () => {
    const { container } = render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0] as FakePC & { ontrack?: (e: unknown) => void };
    act(() => {
      pc.ontrack?.({ streams: [{ id: "s0" }] });
    });
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.srcObject).toEqual({ id: "s0" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("retries on socket error before showing error state", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);

    // First socket error triggers retry
    act(() => {
      FakeWS.instances[0].onclose?.({ wasClean: false } as CloseEvent);
    });
    expect(screen.getByText("Connecting to live view…")).toBeInTheDocument();
    expect(screen.queryByText("Live view unavailable")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(FakeWS.instances.length).toBe(2);

    // Second socket error triggers retry
    act(() => {
      FakeWS.instances[1].onclose?.({ wasClean: false } as CloseEvent);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(FakeWS.instances.length).toBe(3);

    // Third socket error exhausts retries
    act(() => {
      FakeWS.instances[2].onclose?.({ wasClean: false } as CloseEvent);
    });

    expect(screen.getByText("Live view unavailable")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("resets retry counter on successful connection", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);

    // First connection fails → retry
    const pc1 = FakePC.instances[0];
    await act(async () => {
      pc1.connectionState = "failed";
      pc1.onconnectionstatechange?.();
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Second connection succeeds → should show playing, no error
    const pc2 = FakePC.instances[1];
    await act(async () => {
      pc2.connectionState = "connected";
      pc2.onconnectionstatechange?.();
    });
    expect(screen.queryByText("Connecting to live view…")).not.toBeInTheDocument();
    expect(screen.queryByText("Live view unavailable")).not.toBeInTheDocument();

    // Now if THIS connection fails, it should retry again (counter was reset)
    await act(async () => {
      pc2.connectionState = "failed";
      pc2.onconnectionstatechange?.();
    });
    expect(screen.getByText("Connecting to live view…")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("tears down connection when tab is hidden and reconnects when visible", async () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];

    // Connect successfully first
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });
    expect(screen.queryByText("Connecting to live view…")).not.toBeInTheDocument();

    // Tab becomes hidden → should tear down
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(ws.closed).toBe(true);
    expect(pc.closed).toBe(true);

    // Tab becomes visible → should reconnect
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(FakeWS.instances.length).toBe(2);

    // Cleanup: restore document.hidden
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("warns about unsupported audio codec after connection", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeReceiver = {
      track: { kind: "audio" },
      getParameters: () => ({
        codecs: [{ mimeType: "audio/aac" }],
      }),
    };
    const fakeVideoReceiver = {
      track: { kind: "video" },
      getParameters: () => ({
        codecs: [{ mimeType: "video/AV1" }],
      }),
    };

    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    pc.getReceivers.mockReturnValue([fakeReceiver, fakeVideoReceiver]);

    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported audio codec "audio/aac"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ffmpeg:cam#audio=opus'),
    );
    warnSpy.mockRestore();
  });

  it("does not warn for supported audio codec", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeReceiver = {
      track: { kind: "audio" },
      getParameters: () => ({
        codecs: [{ mimeType: "audio/opus" }],
      }),
    };

    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    pc.getReceivers.mockReturnValue([fakeReceiver]);

    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("defaults to a 16:9 letterboxed player with native controls", () => {
    const { container } = render(<VideoStream streamName="cam" />);
    const wrap = container.firstElementChild as HTMLElement;
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(wrap.className).toContain("aspect-video");
    expect(video.className).toContain("object-contain");
    expect(video).toHaveAttribute("controls");
  });

  it("fills its cell, crops to cover, and hides controls in wall mode", () => {
    const { container } = render(
      <VideoStream streamName="cam" fill controls={false} objectFit="cover" />,
    );
    const wrap = container.firstElementChild as HTMLElement;
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(wrap.className).toContain("h-full");
    expect(wrap.className).not.toContain("aspect-video");
    expect(video.className).toContain("object-cover");
    expect(video).not.toHaveAttribute("controls");
  });

  it("does not retry on clean websocket close", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);

    // Clean close should NOT trigger retry
    act(() => {
      FakeWS.instances[0].onclose?.({ wasClean: true } as CloseEvent);
    });

    // Advance timers - no new connection should be created
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(FakeWS.instances.length).toBe(1);
    vi.useRealTimers();
  });

  it("handles codec inspection error gracefully", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    pc.getReceivers.mockImplementation(() => {
      throw new Error("not supported");
    });

    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Codec inspection not supported"),
    );
    debugSpy.mockRestore();
  });

  it("reconnects on visibility change when previously hidden", async () => {
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];

    // Connect successfully first
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });

    // Hide tab
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(FakeWS.instances[0].closed).toBe(true);

    // Show tab again - should reconnect (the else branch in handleVisibility)
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(FakeWS.instances.length).toBe(2);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("handles cleanup errors gracefully", () => {
    const { unmount } = render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    // Make close throw
    ws.close = vi.fn(() => { throw new Error("close failed"); });

    // Should not throw
    expect(() => unmount()).not.toThrow();
    expect(ws.close).toHaveBeenCalled();
  });

  it("handleConnectionFailure no-ops when already closed", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];

    // First failure
    await act(async () => {
      pc.connectionState = "failed";
      pc.onconnectionstatechange?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Second failure (triggers retry)
    const pc2 = FakePC.instances[1];
    await act(async () => {
      pc2.connectionState = "failed";
      pc2.onconnectionstatechange?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Third failure - exhausts retries, sets error state
    const pc3 = FakePC.instances[2];
    await act(async () => {
      pc3.connectionState = "failed";
      pc3.onconnectionstatechange?.();
    });

    expect(screen.getByText("Live view unavailable")).toBeInTheDocument();

    // Now trigger handleConnectionFailure again (closed is already true)
    // Should no-op and not change state
    await act(async () => {
      pc3.connectionState = "failed";
      pc3.onconnectionstatechange?.();
    });

    expect(screen.getByText("Live view unavailable")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("handleVisibility clears retry timer when hidden", async () => {
    vi.useFakeTimers();
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];

    // Trigger a retry (so retryTimerRef.current is set)
    await act(async () => {
      pc.connectionState = "failed";
      pc.onconnectionstatechange?.();
    });

    // Hide tab while retry is pending - should clear retry timer
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance timers by a small amount (less than retry delay) - no new connection should be created
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(FakeWS.instances.length).toBe(1);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    vi.useRealTimers();
  });

  it("handleVisibility handles ws.close throwing", async () => {
    render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];

    // Connect successfully first
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });

    // Make ws.close throw but still set closed=true (simulate partial failure)
    const originalClose = ws.close.bind(ws);
    ws.close = vi.fn(() => {
      originalClose(); // still mark as closed
      throw new Error("close failed");
    });

    // Hide tab - should not throw even though ws.close throws
    await act(async () => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(ws.closed).toBe(true); // our FakeWS still marks closed=true
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });
});
