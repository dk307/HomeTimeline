import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, HardDrive, Video, Clock } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatBytes, formatDuration } from "@/lib/utils";
import { storageApi, scannerApi, recordingsApi } from "@/api/recordings";
import { fmtDt, fmtRelative, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";

const SPARK_DAYS = 30;

function RecordingsChart() {
  const { data: daily } = useQuery({
    queryKey: ["recordings-daily", SPARK_DAYS],
    queryFn: () => recordingsApi.dailyCounts(SPARK_DAYS),
  });

  const data = useMemo(
    () =>
      (daily ?? []).map((d) => ({
        key: d.date,
        label: format(parseISO(d.date), "MMM d"),
        count: d.count,
        secs: d.total_secs,
      })),
    [daily],
  );

  const totalCount = data.reduce((a, b) => a + b.count, 0);
  const totalSecs = data.reduce((a, b) => a + b.secs, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">Recordings activity</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {totalCount.toLocaleString()} clips · {formatDuration(totalSecs)} over {SPARK_DAYS} days
        </span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              yAxisId="count"
              tickLine={false}
              axisLine={false}
              width={28}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              yAxisId="len"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v: number) => formatDuration(v)}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--accent))" }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
                color: "hsl(var(--popover-foreground))",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              formatter={(value: number, name: string) =>
                name === "Clips"
                  ? [`${value} clip${value === 1 ? "" : "s"}`, name]
                  : [formatDuration(value), name]
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="count" name="Clips" dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.count > 0 ? "hsl(var(--primary))" : "hsl(var(--muted))"} />
              ))}
            </Bar>
            <Line
              yAxisId="len"
              name="Total length"
              type="monotone"
              dataKey="secs"
              stroke="hsl(var(--foreground))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
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
        <StatCard label="Total Clip Length" value={stats ? formatDuration(stats.indexed_duration_secs) : "—"} icon={Clock} />
        <StatCard label="Indexed Size" value={stats ? formatBytes(stats.indexed_size_bytes) : "—"} icon={HardDrive} />
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
                  <td className="py-2 text-right text-muted-foreground">{formatDuration(cam.duration_secs)}</td>
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
