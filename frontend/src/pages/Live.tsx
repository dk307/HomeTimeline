import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader, Maximize2, Video } from "lucide-react";

import { camerasApi, type Camera } from "@/api/cameras";
import { cn } from "@/lib/utils";
import VideoStream from "@/components/VideoStream";

/* ------------------------------------------------------------------ layout */

// "auto" fits every camera on screen by picking a near-square column count; the
// numbered options force a fixed cameras-per-row, NVR style.
type Layout = "auto" | 1 | 2 | 3 | 4;

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: 1, label: "1×" },
  { id: 2, label: "2×" },
  { id: 3, label: "3×" },
  { id: 4, label: "4×" },
];

const LAYOUT_KEY = "liveWall.layout";

function loadLayout(): Layout {
  const raw = localStorage.getItem(LAYOUT_KEY);
  if (raw === "auto") return "auto";
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 || n === 4 ? (n as Layout) : "auto";
}

function columnsFor(layout: Layout, count: number): number {
  if (layout !== "auto") return Math.min(layout, Math.max(count, 1));
  // Near-square grid so tiles stay as large as possible.
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/* -------------------------------------------------------------------- tile */

function CameraTile({ camera, quality }: { camera: Camera; quality: "main" | "sub" }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["streams", camera.id],
    queryFn: () => camerasApi.streams(camera.id),
    retry: false,
    staleTime: 60_000,
  });

  const streams = data?.streams ?? [];
  const selected = streams.find((s) => s.quality === quality) ?? streams[0];

  return (
    <div className="group relative min-h-0 overflow-hidden rounded-lg border bg-black">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader size={18} className="animate-spin" />
          <span className="text-sm">Preparing…</span>
        </div>
      )}
      {(isError || (data && !data.available)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground">
          <Video size={24} />
          <span className="text-xs">{data?.reason ?? "Live view unavailable"}</span>
        </div>
      )}
      {selected && (
        <VideoStream key={selected.name} streamName={selected.name} fill controls={false} />
      )}

      {/* Name badge + jump-to-detail control, revealed on hover. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
        <span className="truncate rounded bg-black/40 px-1.5 py-0.5 text-xs font-medium text-white">
          {camera.name}
        </span>
        <Link
          to={`/cameras/${camera.id}`}
          title="Open camera"
          className="pointer-events-auto rounded bg-black/40 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
        >
          <Maximize2 size={13} />
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default function Live() {
  const { data: cameras, isLoading } = useQuery({
    queryKey: ["cameras", true],
    queryFn: () => camerasApi.list(true),
  });

  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [quality, setQuality] = useState<"main" | "sub">("sub");

  function chooseLayout(l: Layout) {
    setLayout(l);
    localStorage.setItem(LAYOUT_KEY, String(l));
  }

  // Live view is only available for Hikvision cameras with a host configured.
  const liveCams = useMemo(
    () => (cameras ?? []).filter((c) => c.camera_type === "hikvision" && (c.host || "").trim()),
    [cameras],
  );

  const cols = columnsFor(layout, liveCams.length);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h1 className="text-xl font-bold">Live View</h1>
          <p className="text-xs text-muted-foreground">
            {liveCams.length} camera{liveCams.length === 1 ? "" : "s"} · sub streams by default
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Quality: sub is light (native H.264); main may transcode. */}
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {(["sub", "main"] as const).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={cn(
                  "rounded px-2.5 py-1 capitalize transition-colors",
                  quality === q
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          {/* Grid layout: cameras per row. Hidden with a single camera, where
              the column count is always clamped to 1 and the choice is a no-op. */}
          {liveCams.length > 1 && (
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                onClick={() => chooseLayout(l.id)}
                title={l.id === "auto" ? "Fit all cameras" : `${l.id} per row`}
                className={cn(
                  "rounded px-2.5 py-1 transition-colors",
                  layout === l.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          )}
        </div>
      </div>

      {liveCams.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Video size={28} />
          <p className="text-sm">
            {isLoading ? "Loading cameras…" : "No live-capable cameras. Live view needs a Hikvision camera with a host."}
          </p>
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2 overflow-auto p-2"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(0, 1fr)",
          }}
        >
          {liveCams.map((cam) => (
            <CameraTile key={cam.id} camera={cam} quality={quality} />
          ))}
        </div>
      )}
    </div>
  );
}
