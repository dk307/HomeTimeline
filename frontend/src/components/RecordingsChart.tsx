import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays, differenceInCalendarDays } from "date-fns";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
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
import { recordingsApi } from "@/api/recordings";
import { formatDuration } from "@/lib/utils";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { DateRangePicker, SHARED_PRESETS } from "@/components/ui/date-range-picker";

type PresetId = "today" | "yesterday" | "7d" | "14d" | "30d" | "60d" | "90d" | "180d" | "custom";

interface ChartPreset {
  id: string;
  label: string;
  days: number;
  from: () => string;
  to: () => string;
}

const PRESETS: ChartPreset[] = SHARED_PRESETS.map((p) => {
  const days = p.id === "today" ? 1 : p.id === "yesterday" ? 1 :
    parseInt(p.id) || 1;
  return { ...p, days };
});

function effectiveRange(preset: string, customFrom: string, customTo: string): { from?: Date; to?: Date; days: number } {
  if (preset === "custom") {
    if (!customFrom) return { days: 30 };
    const end = customTo || customFrom;
    const diff = customTo ? differenceInCalendarDays(parseISO(end), parseISO(customFrom)) + 1 : 1;
    return { from: parseISO(customFrom), to: parseISO(end), days: Math.max(1, diff) };
  }
  const p = PRESETS.find((pr) => pr.id === preset);
  if (!p) return { days: 30 };
  return { from: subDays(new Date(), p.days - 1), to: new Date(), days: p.days };
}

interface RecordingsChartProps {
  cameraId?: number;
}

export default function RecordingsChart({ cameraId }: RecordingsChartProps) {
  const { preset, setPreset, from: customFrom, setFrom: setCustomFrom, to: customTo, setTo: setCustomTo } =
    usePersistedDateRange("recordings-chart-range", { preset: "30d", from: "", to: "", days: 30 });

  function handleChange(newPreset: string, from: string, to: string) {
    setPreset(newPreset as PresetId);
    setCustomFrom(from);
    setCustomTo(to);
  }

  const { days } = effectiveRange(preset, customFrom, customTo);

  const { data: daily, isLoading } = useQuery({
    queryKey: ["recordings-daily", days, cameraId],
    queryFn: () => recordingsApi.dailyCounts(days, cameraId),
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

  if (isLoading) return <ChartSkeleton />;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">Recordings activity</h2>
        <div className="flex items-center gap-1">
          <DateRangePicker
            presets={PRESETS}
            value={{ preset, from: customFrom, to: customTo }}
            onChange={handleChange}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums mb-3">
        {totalCount.toLocaleString()} clips · {formatDuration(totalSecs)} over {days} days
      </p>
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
              content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as { count?: number; secs?: number } | undefined;
                return (
                  <div
                    style={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      color: "hsl(var(--popover-foreground))",
                    }}
                  >
                    <p style={{ fontWeight: 600, marginBottom: 4, color: "hsl(var(--foreground))" }}>{label}</p>
                    {point?.count != null && (
                      <p>
                        {point.count} clip{point.count === 1 ? "" : "s"}
                      </p>
                    )}
                    {point?.secs != null && <p>Total length: {formatDuration(point.secs)}</p>}
                  </div>
                );
              }}
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
