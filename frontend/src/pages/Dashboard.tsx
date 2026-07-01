import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, HardDrive, Video, Camera } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { storageApi, scannerApi } from "@/api/recordings";
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

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { data: stats } = useQuery({ queryKey: ["storage-stats"], queryFn: storageApi.stats });
  const { data: scanStatus } = useQuery({
    queryKey: ["scan-status"],
    queryFn: scannerApi.status,
    refetchInterval: 3000,
  });

  const triggerScan = useMutation({
    mutationFn: scannerApi.trigger,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scan-status"] }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button
          onClick={() => triggerScan.mutate()}
          disabled={scanStatus?.running}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          <RefreshCw size={14} className={scanStatus?.running ? "animate-spin" : ""} />
          {scanStatus?.running ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {/* Summary stat cards — 3 cards, no Disk Used */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Recordings"
          value={String(stats?.indexed_recordings ?? "—")}
          icon={Video}
        />
        <StatCard
          label="Indexed Size"
          value={stats ? formatBytes(stats.indexed_size_bytes) : "—"}
          icon={HardDrive}
        />
        <StatCard
          label="Active Cameras"
          value={stats ? String(stats.cameras.filter((c) => c.enabled).length) : "—"}
          icon={Camera}
        />
      </div>

      {/* Per-camera table */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold mb-4">Cameras</h2>
        {stats?.cameras.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="pb-2 font-medium">Camera</th>
                <th className="pb-2 font-medium text-right">Recordings</th>
                <th className="pb-2 font-medium text-right">Indexed Size</th>
                <th className="pb-2 font-medium text-right">Latest Video</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.cameras.map((cam) => (
                <tr key={cam.id} className={cam.enabled ? "" : "opacity-40"}>
                  <td className="py-2 font-medium">{cam.name}</td>
                  <td className="py-2 text-right">{cam.recordings.toLocaleString()}</td>
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

      {/* Last scan footer */}
      {(scanStatus?.last_run || stats?.last_scan_finished) && (
        <p className="text-xs text-muted-foreground">
          Last scan completed: {new Date(scanStatus?.last_run ?? stats?.last_scan_finished ?? "").toLocaleString()}
          {scanStatus?.last_result && (
            <> — {Object.values(scanStatus.last_result).reduce((a, b) => a + b, 0)} new recordings</>
          )}
        </p>
      )}
    </div>
  );
}
