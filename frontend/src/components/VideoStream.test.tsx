import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("shows an error with a working retry that re-negotiates", async () => {
    render(<VideoStream streamName="cam" />);
    const pc = FakePC.instances[0];
    await act(async () => {
      pc.connectionState = "failed";
      pc.onconnectionstatechange?.();
    });

    expect(screen.getByText("Live view unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    // Retry bumps the attempt, tearing down and re-opening the socket.
    await waitFor(() => expect(FakeWS.instances.length).toBe(2));
  });

  it("tears down the socket and peer connection on unmount", () => {
    const { unmount } = render(<VideoStream streamName="cam" />);
    const ws = FakeWS.instances[0];
    const pc = FakePC.instances[0];
    unmount();
    expect(ws.closed).toBe(true);
    expect(pc.closed).toBe(true);
  });
});
