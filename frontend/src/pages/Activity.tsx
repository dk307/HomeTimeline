import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fmtDt, FMT_DATETIME } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { Badge } from "@/components/ui/badge";

interface ActivityEvent {
  type: "scan" | "download" | "purge";
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "error";
  detail: string | null;
  // scan-only
  new_recordings?: number;
  skipped_recordings?: number;
  cameras_scanned?: number;
  // download/purge (per-camera)
  camera?: string;
  // download-only
  downloaded?: number;
  indexed?: number;
  // purge-only
  deleted?: number;
  freed_bytes?: number;
}

function formatBytes(n: number): string {
  let size = n;
  for (const unit of ["B", "KB", "MB", "GB", "TB"]) {
    if (size < 1024 || unit === "TB")
      return unit === "B" ? `${size} B` : `${size.toFixed(1)} ${unit}`;
    size /= 1024;
  }
  return `${n} B`;
}

async function fetchActivity(): Promise<ActivityEvent[]> {
  const r = await fetch("/api/v1/activity");
  if (!r.ok) throw new Error("Failed to fetch activity");
  return r.json();
}

function calcDuration(start: string, end: string | null): string {
  if (!end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "";
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s";
}

function isStale(e: ActivityEvent): boolean {
  if (e.finished_at) return false;
  return Date.now() - new Date(e.started_at).getTime() > 15 * 60 * 1000;
}

function StatusIcon({ e }: { e: ActivityEvent }) {
  if (isStale(e))
    return <span title="Stale — no completion recorded"><AlertCircle size={16} className="text-yellow-500 shrink-0" /></span>;
  if (!e.finished_at)
    return <Loader2 size={16} className="text-blue-500 animate-spin shrink-0" />;
  if (e.status === "ok")
    return <CheckCircle size={16} className="text-green-500 shrink-0" />;
  return <XCircle size={16} className="text-red-500 shrink-0" />;
}

export default function Activity() {
  const tz = useTimezone();
  const { data = [], dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ["activity"],
    queryFn: fetchActivity,
    refetchInterval: 10000,
  });

  const updated = dataUpdatedAt
    ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })
    : "—";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Updated {updated}</span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          No scan or download activity yet.
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {data.map((e) => {
            const stale = isStale(e);
            const running = !e.finished_at && !stale;
            const dur = calcDuration(e.started_at, e.finished_at);
            const isDownload = e.type === "download";
            const isPurge = e.type === "purge";
            const perCamera = isDownload || isPurge;
            const verb = isDownload ? "Download" : isPurge ? "Purge" : "Scan";
            const gerund = isDownload ? "Downloading…" : isPurge ? "Purging…" : "Scanning…";
            const title = running
              ? gerund
              : stale
                ? `${verb} (incomplete)`
                : `${verb} complete`;
            return (
              <div key={`${e.type}-${e.id}`} className="flex items-start gap-3 px-4 py-3.5">
                <div className="mt-0.5"><StatusIcon e={e} /></div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{title}</span>
                    {isDownload && (
                      <>
                        {(e.downloaded ?? 0) > 0 && (
                          <Badge variant="success">+{e.downloaded} downloaded</Badge>
                        )}
                        {(e.indexed ?? 0) > 0 && (
                          <Badge variant="secondary">{e.indexed} indexed</Badge>
                        )}
                      </>
                    )}
                    {isPurge && (
                      <>
                        {(e.deleted ?? 0) > 0 && (
                          <Badge variant="secondary">{e.deleted} deleted</Badge>
                        )}
                        {(e.freed_bytes ?? 0) > 0 && (
                          <Badge variant="secondary">{formatBytes(e.freed_bytes ?? 0)} freed</Badge>
                        )}
                      </>
                    )}
                    {!isDownload && !isPurge && (
                      <>
                        {(e.new_recordings ?? 0) > 0 && (
                          <Badge variant="success">+{e.new_recordings} new</Badge>
                        )}
                        {(e.skipped_recordings ?? 0) > 0 && (
                          <Badge variant="secondary">{e.skipped_recordings} already indexed</Badge>
                        )}
                      </>
                    )}
                    {e.status === "error" && <Badge variant="destructive">error</Badge>}
                  </div>
                  <div className="flex gap-x-4 gap-y-0.5 flex-wrap text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground/60">Start</span>{" "}
                      {fmtDt(e.started_at, tz, FMT_DATETIME)}
                    </span>
                    {e.finished_at && (
                      <span>
                        <span className="font-medium text-foreground/60">End</span>{" "}
                        {fmtDt(e.finished_at, tz, FMT_DATETIME)}
                      </span>
                    )}
                    {dur && (
                      <span>
                        <span className="font-medium text-foreground/60">Duration</span>{" "}
                        {dur}
                      </span>
                    )}
                    <span>
                      <span className="font-medium text-foreground/60">
                        {perCamera ? "Camera" : "Cameras"}
                      </span>{" "}
                      {perCamera ? e.camera : e.cameras_scanned}
                    </span>
                  </div>
                  {e.detail && (
                    <p className={"text-xs font-mono mt-0.5 " + (e.status === "error" ? "text-red-500" : "text-muted-foreground")}>
                      {e.detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
