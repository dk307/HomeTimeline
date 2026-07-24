import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, HardDrive, Video, Clock, Download, Trash2 } from "lucide-react";
import { formatBytes, formatDuration, toErrorMessage } from "@/lib/utils";
import { storageApi, scannerApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import { fmtDt, fmtRelative, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CardSkeleton, ChartSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import RecordingsChart from "@/components/RecordingsChart";

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-4">
      <div className="p-2 rounded-md bg-primary/10">
        <Icon size={20} className="text-primary" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const tz = useTimezone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ["storage-stats"], queryFn: storageApi.stats });
  const { data: scanStatus } = useQuery({
    queryKey: ["scan-status"],
    queryFn: scannerApi.status,
    refetchInterval: 3000,
  });

  // Global Hikvision bulk-action state: `available` gates the button (no camera has
  // the capability → disabled), `running` shows progress + prevents double-fire.
  const { data: downloadAll } = useQuery({
    queryKey: ["download-all-status"],
    queryFn: camerasApi.downloadAllStatus,
    refetchInterval: 3000,
  });
  const { data: purgeAll } = useQuery({
    queryKey: ["purge-all-status"],
    queryFn: camerasApi.purgeAllStatus,
    refetchInterval: 3000,
  });

  const triggerScan = useMutation({
    mutationFn: scannerApi.trigger,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scan-status"] });
      toast("Scan started", { description: "Scanning recording paths for new files." });
    },
    onError: (e) => toast("Scan failed", { description: toErrorMessage(e), variant: "error" }),
  });
  const triggerDownloadAll = useMutation({
    mutationFn: camerasApi.downloadAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["download-all-status"] });
      toast("Download started", { description: "Downloading clips from Hikvision cameras." });
    },
    onError: (e) => toast("Download failed", { description: toErrorMessage(e), variant: "error" }),
  });
  const triggerPurgeAll = useMutation({
    mutationFn: camerasApi.purgeAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purge-all-status"] });
      toast("Purge completed", { description: "Old clips have been removed.", variant: "success" });
    },
    onError: (e) => toast("Purge failed", { description: toErrorMessage(e), variant: "error" }),
  });

  const downloadRunning = !!downloadAll?.running;
  const purgeRunning = !!purgeAll?.running;

  // Completion-driven refresh (mirrors CameraDetail's DownloadButton/PurgeButton):
  // when a bulk run's status flips from running → idle, the indexed set changed, so
  // refresh the storage stats and the recordings chart.
  const prevDownloadRunning = useRef(false);
  const prevPurgeRunning = useRef(false);
  useEffect(() => {
    if (prevDownloadRunning.current && !downloadRunning) {
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
    }
    prevDownloadRunning.current = downloadRunning;
  }, [downloadRunning, qc]);
  useEffect(() => {
    if (prevPurgeRunning.current && !purgeRunning) {
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
    }
    prevPurgeRunning.current = purgeRunning;
  }, [purgeRunning, qc]);

  async function onPurgeAll() {
    const ok = await confirm({
      title: "Purge old videos?",
      message:
        "Video files, thumbnails, and index entries older than each camera's " +
        "cutoff are permanently removed.",
      confirmLabel: "Purge",
      destructive: true,
    });
    if (!ok) return;
    triggerPurgeAll.mutate();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => triggerScan.mutate()}
            disabled={scanStatus?.running}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            <RefreshCw size={14} className={scanStatus?.running ? "animate-spin" : ""} />
            {scanStatus?.running ? "Scanning..." : "Scan Disk"}
          </button>
          <button
            onClick={() => triggerDownloadAll.mutate()}
            disabled={!downloadAll?.available || downloadRunning || triggerDownloadAll.isPending}
            title={
              downloadAll?.available
                ? "Download new clips from all Hikvision cameras"
                : "No Hikvision cameras configured"
            }
            className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <Download size={14} className={downloadRunning ? "animate-pulse" : ""} />
            {downloadRunning ? "Downloading..." : "Download Videos"}
          </button>
          <button
            onClick={onPurgeAll}
            disabled={!purgeAll?.available || purgeRunning || triggerPurgeAll.isPending}
            title={
              purgeAll?.available
                ? "Purge old clips from all Hikvision cameras with a retention window"
                : "No Hikvision cameras with a purge retention configured"
            }
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          >
            <Trash2 size={14} className={purgeRunning ? "animate-pulse" : ""} />
            {purgeRunning ? "Purging..." : "Purge Videos"}
          </button>
        </div>
      </div>

      {confirmDialog}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statsLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <StatCard label="Total Recordings" value={String(stats?.indexed_recordings ?? "—")} icon={Video} />
            <StatCard label="Total Clip Length" value={stats ? formatDuration(stats.indexed_duration_secs) : "—"} icon={Clock} />
            <StatCard label="Indexed Size" value={stats ? formatBytes(stats.indexed_size_bytes) : "—"} icon={HardDrive} />
          </>
        )}
      </div>

      {statsLoading ? <ChartSkeleton /> : <RecordingsChart />}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold mb-4">Cameras</h2>
        {statsLoading ? (
          <TableSkeleton rows={3} cols={5} />
        ) : stats?.cameras.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="pb-2 font-medium">Camera</th>
                <th className="pb-2 font-medium text-right">Recordings</th>
                <th className="pb-2 font-medium text-right">Clip Length</th>
                <th className="pb-2 font-medium text-right">Indexed Size</th>
                <th className="pb-2 font-medium text-right">Latest Video</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.cameras.map((cam) => (
                <tr key={cam.id} className={cam.enabled ? "" : "opacity-40"}>
                  <td className="py-2 font-medium">{cam.name}</td>
                  <td className="py-2 text-right">{cam.recordings.toLocaleString()}</td>
                  <td className="py-2 text-right text-muted-foreground">{formatDuration(cam.indexed_duration_secs)}</td>
                  <td className="py-2 text-right text-muted-foreground">{formatBytes(cam.indexed_size_bytes)}</td>
                  <td className="py-2 text-right text-muted-foreground" title={cam.latest_video_at ?? ""}>
                    {fmtRelative(cam.latest_video_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted-foreground text-sm">No cameras configured yet.</p>
        )}
      </div>

      {(scanStatus?.last_run || stats?.last_scan_finished) && (
        <p className="text-xs text-muted-foreground">
          Last scan completed:{" "}
          {fmtDt(scanStatus?.last_run ?? stats?.last_scan_finished, tz, FMT_DATETIME_SHORT)}
          {scanStatus?.last_result && (
            <> — {Object.values(scanStatus.last_result).reduce((a, b) => a + b, 0)} new recordings</>
          )}
        </p>
      )}
    </div>
  );
}
