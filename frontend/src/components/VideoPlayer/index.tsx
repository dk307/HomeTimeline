import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Maximize, Minimize, X } from "lucide-react";
import { format } from "date-fns";
import { recordingsApi } from "@/api/recordings";
import { formatDuration } from "@/lib/utils";
import { useUIStore, type UIState } from "@/store/ui";

export default function VideoPlayer({
  recordingId,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  recordingId: number;
  onClose?: () => void;
  /** Step to the previous clip; omit/undefined disables the control. */
  onPrev?: () => void;
  /** Step to the next clip; omit/undefined disables the control. */
  onNext?: () => void;
  /** 1-based position within the current camera's clip sequence, for the counter. */
  position?: { index: number; total: number };
}) {
  const setSelectedRecording = useUIStore((s: UIState) => s.setSelectedRecording);
  // Each page owns the open/close state differently (store vs. local), so prefer
  // the caller's handler; fall back to the shared store for the store-driven page.
  const close = onClose ?? (() => setSelectedRecording(null));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    function onChange() {
      const el = videoRef.current;
      if (!el) return;
      setIsFullscreen(
        document.fullscreenElement === el ||
          (document as any).webkitFullscreenElement === el,
      );
    }
    function onWebkitEnd() { setIsFullscreen(false); }
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    const el = videoRef.current;
    el?.addEventListener("webkitendfullscreen", onWebkitEnd);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      el?.removeEventListener("webkitendfullscreen", onWebkitEnd);
    };
  }, []);

  function toggleFullscreen() {
    const el = videoRef.current;
    if (!el) return;
    if (isFullscreen) {
      (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.())
        ?.catch?.(() => {});
    } else if ((el as any).webkitEnterFullscreen) {
      (el as any).webkitEnterFullscreen();
    } else {
      (el.requestFullscreen?.() ?? (el as any).webkitRequestFullscreen?.())
        ?.catch?.(() => {});
    }
  }
  const { data: rec } = useQuery({
    queryKey: ["recording", recordingId],
    queryFn: () => recordingsApi.get(recordingId),
  });

  // Arrow keys step between clips, matching typical NVR review UX. We ignore the
  // event when another widget owns the arrow keys: the <video> (native frame
  // seek), a form field, or a component with its own arrow navigation — notably
  // the date-picker calendar (react-day-picker moves between day buttons with
  // ←/→) and any dialog/grid. We also don't preventDefault when there's nowhere
  // to go, so the key still bubbles.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const el = document.activeElement;
      if (
        el instanceof HTMLVideoElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.closest('.ht-cal, [role="grid"], [role="dialog"]'))
      )
        return;
      const handler = ev.key === "ArrowLeft" ? onPrev : onNext;
      if (!handler) return;
      ev.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);

  const streamUrl  = recordingsApi.streamUrl(recordingId);
  const downloadUrl = recordingsApi.downloadUrl(recordingId);

  const navBtn =
    "p-1 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 min-w-0">
          {(onPrev || onNext) && (
            <div className="flex items-center gap-0.5 mr-1">
              <button onClick={onPrev} disabled={!onPrev} className={navBtn} title="Previous clip (←)" aria-label="Previous clip">
                <ChevronLeft size={16} />
              </button>
              <button onClick={onNext} disabled={!onNext} className={navBtn} title="Next clip (→)" aria-label="Next clip">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <div className="text-sm truncate">
            <span className="font-medium">Recording #{recordingId}</span>
            {position && position.total > 1 && (
              <span className="text-muted-foreground ml-2 tabular-nums">
                {position.index} / {position.total}
              </span>
            )}
            {rec && (
              <span className="text-muted-foreground ml-2">
                {format(new Date(rec.start_time), "MMM d, HH:mm")} · {formatDuration(rec.duration_secs)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            download
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-accent"
            title="Download"
          >
            <Download size={13} /> Download
          </a>
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded hover:bg-accent"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
          <button onClick={close} className="p-1 rounded hover:bg-accent" title="Close" aria-label="Close">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="bg-black">
        <video
          ref={videoRef}
          key={streamUrl}
          src={streamUrl}
          controls
          autoPlay
          preload="metadata"
          className="w-full max-h-[60vh]"
        >
          <source src={streamUrl} type="video/mp4" />
          <source src={streamUrl} type="video/x-matroska" />
        </video>
      </div>
    </div>
  );
}
