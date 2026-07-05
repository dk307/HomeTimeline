import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Cctv, ChevronRight, Clock, Video } from "lucide-react";
import { camerasApi } from "@/api/cameras";
import { storageApi } from "@/api/recordings";
import { formatBytes, formatDuration } from "@/lib/utils";
import { fmtRelative } from "@/lib/tz";

export default function Cameras() {
  const { data: cameras, isLoading } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list() });
  const { data: stats } = useQuery({ queryKey: ["storage-stats"], queryFn: storageApi.stats });

  const statById = new Map((stats?.cameras ?? []).map((c) => [c.id, c]));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cameras</h1>

      {cameras?.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cameras.map((cam) => {
            const s = statById.get(cam.id);
            return (
              <Link
                key={cam.id}
                to={`/cameras/${cam.id}`}
                className={
                  "group rounded-lg border bg-card p-4 flex flex-col gap-3 transition-colors hover:border-primary hover:bg-accent/40 " +
                  (cam.enabled ? "" : "opacity-60")
                }
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Cctv size={20} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{cam.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {cam.description || cam.recording_path}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground group-hover:translate-x-0.5 transition-transform"
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Video size={13} />
                    {(s?.recordings ?? 0).toLocaleString()} clips
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={13} />
                    {formatDuration(s?.duration_secs ?? 0)}
                  </span>
                  <span>{formatBytes(s?.indexed_size_bytes ?? 0)}</span>
                  <span title={s?.latest_video_at ?? ""}>{fmtRelative(s?.latest_video_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <p className="text-muted-foreground text-sm">No cameras configured yet.</p>
      )}
    </div>
  );
}
