import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, HardDrive, Video, Camera } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { eachDayOfInterval, format, subDays } from "date-fns";
import { formatBytes } from "@/lib/utils";
import { storageApi, scannerApi, recordingsApi } from "@/api/recordings";
import { fmtDt, fmtRelative, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";

const SPARK_DAYS = 30;

function RecordingsChart() {
  const { data: recs } = useQuery({
    queryKey: ["recordings-spark", SPARK_DAYS],
    queryFn: () => recordingsApi.list({ date: format(subDays(new Date(), SPARK_DAYS - 1), "yyyy-MM-dd"), days: SPARK_DAYS }),
  });

  const data = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(new Date(), SPARK_DAYS - 1), end: new Date() });
    const counts = new Map<string, number>(days.map((d) => [format(d, "yyyy-MM-dd"), 0]));
    for (const r of recs ?? []) {
      const key = r.start_time.slice(0, 10);
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return days.map((d) => {
      const key = format(d, "yyyy-MM-dd");
      return { key, label: format(d, "MMM d"), count: counts.get(key) ?? 0 };
    });
  }, [recs]);

  const total = data.reduce((a, b) => a + b.count, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">Recordings activity</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} in last {SPARK_DAYS} days</span>
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap={2}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              cursor={{ fill: "hsl(var(--accent))" }}
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              formatter={(v: number) => [`${v} recording${v === 1 ? "" : "s"}`, ""]}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.count > 0 ? "hsl(var(--primary))" : "hsl(var(--muted))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Recordings" value={String(stats?.indexed_recordings ?? "—")} icon={Video} />
        <StatCard label="Indexed Size" value={stats ? formatBytes(stats.indexed_size_bytes) : "—"} icon={HardDrive} />
        <StatCard label="Active Cameras" value={stats ? String(stats.cameras.filter((c) => c.enabled).length) : "—"} icon={Camera} />
      </div>

      <RecordingsChart />

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
