import { useEffect, useRef, useState } from "react";
import { Loader, RefreshCw, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

type State = "connecting" | "playing" | "error";

/**
 * Live camera view via WebRTC. Signaling runs over our own origin (the backend
 * proxies the go2rtc WebSocket); media flows over WebRTC (go2rtc's published TCP
 * port). If negotiation fails, we surface a clear error with a retry rather than
 * a frozen black frame.
 *
 * By default the player renders at a 16:9 aspect ratio with native controls. In
 * a multi-camera wall, pass ``fill`` so it stretches to fill its grid cell, and
 * usually ``controls={false}`` to keep the tiles clean.
 */
export default function VideoStream({
  streamName,
  fill = false,
  controls = true,
  objectFit = "contain",
}: {
  streamName: string;
  fill?: boolean;
  controls?: boolean;
  objectFit?: "contain" | "cover";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setState("connecting");

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${proto}://${location.host}/api/v1/cameras/live/ws?src=${encodeURIComponent(
      streamName,
    )}`;
    const ws = new WebSocket(wsUrl);
    const pc = new RTCPeerConnection({ iceServers: [] });
    let closed = false;

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (ev) => {
      video.srcObject = ev.streams[0];
      video.play().catch(() => {});
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "webrtc/candidate", value: ev.candidate.candidate }));
      }
    };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      if (pc.connectionState === "connected") setState("playing");
      else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) setState("error");
    };

    ws.onopen = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
      } catch {
        if (!closed) setState("error");
      }
    };
    ws.onmessage = async (ev) => {
      let msg: { type?: string; value?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "webrtc/answer" && msg.value) {
        await pc.setRemoteDescription({ type: "answer", sdp: msg.value }).catch(() => {});
      } else if (msg.type === "webrtc/candidate" && msg.value) {
        await pc.addIceCandidate({ candidate: msg.value, sdpMid: "0" }).catch(() => {});
      }
    };
    ws.onerror = () => {
      if (!closed) setState("error");
    };

    // Fail if we haven't connected within a reasonable window.
    const timer = window.setTimeout(() => {
      if (!closed && pc.connectionState !== "connected") setState("error");
    }, 12000);

    return () => {
      closed = true;
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      pc.close();
      video.srcObject = null;
    };
  }, [streamName, attempt]);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md bg-black",
        fill ? "h-full" : "aspect-video",
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        controls={controls}
        className={cn("h-full w-full", objectFit === "cover" ? "object-cover" : "object-contain")}
      />
      {state !== "playing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
          {state === "connecting" ? (
            <>
              <Loader size={28} className="animate-spin" />
              <p className="text-sm">Connecting to live view…</p>
            </>
          ) : (
            <>
              <VideoOff size={28} />
              <p className="text-sm">Live view unavailable</p>
              <button
                onClick={() => setAttempt((a) => a + 1)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-white/30 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                <RefreshCw size={13} /> Retry
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
