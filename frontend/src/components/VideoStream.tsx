import { useEffect, useRef, useState } from "react";
import { Loader, RefreshCw, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

type State = "connecting" | "buffering" | "playing" | "error";

const MAX_AUTO_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const CONNECTION_TIMEOUT_MS = 12_000;
// A WebRTC session can report "connected" while still sitting black if no
// decodable frame arrives (e.g. a slow transcode or a dead track). Watch for
// actual video data so we surface a buffering state / retry instead of a frozen
// empty tile.
const FRAME_POLL_MS = 400;
const FRAME_TIMEOUT_MS = 10_000;

const SUPPORTED_AUDIO_CODECS = new Set([
  "audio/opus",
  "audio/pcma",
  "audio/pcmu",
  "audio/red",
  "audio/telephone-event",
]);

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
  const autoRetriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const frameTimerRef = useRef<number | null>(null);

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

    // ── Auto-retry on failure ──────────────────────────────────────────────
    function clearFrameTimer() {
      if (frameTimerRef.current) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
    }

    function startConnectionTimeout() {
      return window.setTimeout(() => {
        if (!closed && pc.connectionState !== "connected") handleConnectionFailure();
      }, CONNECTION_TIMEOUT_MS);
    }

    // Watch for a decodable frame after a successful WebRTC connection. If the
    // browser is connected but never renders a frame, retry instead of leaving a
    // permanent black tile.
    function startFrameWatch() {
      if (!video) return;
      clearFrameTimer();
      setState("buffering");
      const startedAt = Date.now();
      frameTimerRef.current = window.setInterval(() => {
        if (closed) {
          clearFrameTimer();
          return;
        }
        if (video.videoWidth > 0 && video.readyState >= 2) {
          clearFrameTimer();
          setState("playing");
          return;
        }
        if (Date.now() - startedAt >= FRAME_TIMEOUT_MS) {
          clearFrameTimer();
          handleConnectionFailure();
        }
      }, FRAME_POLL_MS);
    }

    function handleConnectionFailure() {
      if (closed) return;
      closed = true;
      window.clearTimeout(timer);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      clearFrameTimer();
      try {
        ws.close();
      } catch {
        /* noop */
      }
      pc.close();
      if (video) video.srcObject = null;

      if (autoRetriesRef.current < MAX_AUTO_RETRIES) {
        autoRetriesRef.current++;
        setState("connecting");
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setAttempt((a) => a + 1);
        }, RETRY_DELAY_MS);
      } else {
        setState("error");
      }
    }

    // ── Audio codec validation ─────────────────────────────────────────────
    function logNegotiatedCodecs(connection: RTCPeerConnection) {
      try {
        for (const r of connection.getReceivers()) {
          if (r.track?.kind !== "audio") continue;
          const params = r.getParameters();
          for (const codec of params.codecs ?? []) {
            if (!SUPPORTED_AUDIO_CODECS.has(codec.mimeType)) {
              console.warn(
                `[VideoStream] Unsupported audio codec "${codec.mimeType}". ` +
                  `WebRTC requires Opus, PCMA, or PCMU. Configure go2rtc with ` +
                  `"ffmpeg:${streamName}#audio=opus" to transcode.`,
              );
            }
          }
        }
      } catch {
        // Codec inspection not supported in this browser — skip.
        console.debug("[VideoStream] Codec inspection not supported (getReceivers/getParameters)");
      }
    }

    pc.ontrack = (ev) => {
      if (closed) return;
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
      if (pc.connectionState === "connected") {
        autoRetriesRef.current = 0;
        logNegotiatedCodecs(pc);
        startFrameWatch();
      } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        handleConnectionFailure();
      }
    };

    ws.onopen = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
      } catch {
        if (!closed) handleConnectionFailure();
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
    ws.onclose = (ev) => {
      if (!closed && !ev.wasClean) {
        handleConnectionFailure();
      }
    };
    // onerror fires for transient blips; onclose with wasClean=false is the reliable signal.
    ws.onerror = () => {
      /* intentionally empty — handled by onclose */
    };

    // Fail if we haven't connected within a reasonable window.
    let timer = startConnectionTimeout();

    // ── Visibility handling: tear down when hidden, reconnect when visible ─
    const handleVisibility = () => {
      if (document.hidden && !closed) {
        closed = true;
        window.clearTimeout(timer);
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        clearFrameTimer();
        try {
          ws.close();
        } catch {
          /* noop */
        }
        pc.close();
        video.srcObject = null;
      } else if (!document.hidden && closed) {
        autoRetriesRef.current = 0;
        setAttempt((a) => a + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      closed = true;
      window.clearTimeout(timer);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      clearFrameTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
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
          {state === "error" ? (
            <>
              <VideoOff size={28} />
              <p className="text-sm">Live view unavailable</p>
              <button
                onClick={() => {
                  autoRetriesRef.current = 0;
                  setAttempt((a) => a + 1);
                }}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-white/30 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                <RefreshCw size={13} /> Retry
              </button>
            </>
          ) : (
            <>
              <Loader size={28} className="animate-spin" />
              <p className="text-sm">
                {state === "buffering" ? "Buffering live video…" : "Connecting to live view…"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
