import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays, addDays, differenceInCalendarDays } from "date-fns";
import type { RangeValue } from "@/components/Calendar";
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
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { recordingsApi } from "@/api/recordings";
import { formatDuration } from "@/lib/utils";
import RangeCalendar from "@/components/Calendar";
import { ChartSkeleton } from "@/components/ui/skeleton";

type PresetId = "7d" | "14d" | "30d" | "60d" | "90d" | "custom";

const PRESETS: { id: PresetId; label: string; days: number }[] = [
  { id: "7d",  label: "Last 7 days",  days: 7  },
  { id: "14d", label: "Last 14 days", days: 14 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "60d", label: "Last 60 days", days: 60 },
  { id: "90d", label: "Last 90 days", days: 90 },
];

function effectiveRange(preset: PresetId, customFrom: string, customTo: string): { from?: Date; to?: Date; days: number } {
  if (preset === "custom") {
    if (!customFrom) return { days: 30 };
    const end = customTo || customFrom;
    const diff = customTo ? differenceInCalendarDays(parseISO(end), parseISO(customFrom)) + 1 : 1;
    return { from: parseISO(customFrom), to: parseISO(end), days: Math.max(1, diff) };
  }
  const p = PRESETS.find((pr) => pr.id === preset)!;
  return { from: subDays(new Date(), p.days - 1), to: new Date(), days: p.days };
}

function rangeLabel(preset: PresetId, customFrom: string, customTo: string): string {
  const { from, to } = effectiveRange(preset, customFrom, customTo);
  if (!from || !to) return "";
  if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) return format(from, "MMM d, yyyy");
  const sameYear = from.getFullYear() === to.getFullYear();
  return format(from, sameYear ? "MMM d" : "MMM d, yyyy") + " – " + format(to, "MMM d, yyyy");
}

interface DateRangeSelectorProps {
  preset: PresetId;
  setPreset: (p: PresetId) => void;
  customFrom: string;
  setCustomFrom: (s: string) => void;
  customTo: string;
  setCustomTo: (s: string) => void;
}

function DateRangeSelector({ preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo }: DateRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const canNav = true;

  function goPrev() {
    const { from, to, days } = effectiveRange(preset, customFrom, customTo);
    if (!from || !to) return;
    const newFrom = format(subDays(from, days), "yyyy-MM-dd");
    const newTo = format(subDays(to, days), "yyyy-MM-dd");
    setPreset("custom");
    setCustomFrom(newFrom);
    setCustomTo(newTo);
  }

  const canGoNext = (() => {
    const { to } = effectiveRange(preset, customFrom, customTo);
    if (!to) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return to < today;
  })();

  function goNext() {
    const { from, to, days } = effectiveRange(preset, customFrom, customTo);
    if (!from || !to) return;
    const newFrom = format(addDays(from, days), "yyyy-MM-dd");
    const newTo = format(addDays(to, days), "yyyy-MM-dd");
    setPreset("custom");
    setCustomFrom(newFrom);
    setCustomTo(newTo);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const pw = popRef.current?.offsetWidth ?? 0;
      const left = Math.max(8, Math.min(b.left, window.innerWidth - pw - 8));
      setPos({ top: b.bottom + 6, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function applyPreset(id: PresetId) {
    setPreset(id);
    setCustomFrom("");
    setCustomTo("");
    setOpen(false);
  }

  function handleSelect(range: RangeValue | undefined) {
    if (!range?.from) return;
    setPreset("custom");
    setCustomFrom(format(range.from, "yyyy-MM-dd"));
    if (range.to) {
      setCustomTo(format(range.to, "yyyy-MM-dd"));
      setOpen(false);
    } else {
      setCustomTo("");
    }
  }

  const label = PRESETS.find((p) => p.id === preset)?.label ?? "Custom range";
  const summary = rangeLabel(preset, customFrom, customTo);
  const { from, to: effectiveTo } = effectiveRange(preset, customFrom, customTo);

  const popup = open
    ? createPortal(
        <div
          ref={popRef}
          className="fixed z-[100] w-max rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden flex"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="flex flex-col p-1.5 gap-0.5 border-r bg-muted/30 min-w-[9rem]">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={
                  "w-full text-left px-3 py-1.5 rounded text-sm transition-colors whitespace-nowrap " +
                  (preset === p.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground")
                }
              >
                {p.label}
              </button>
            ))}
            <div
              className={
                "mt-0.5 px-3 py-1.5 rounded text-sm whitespace-nowrap " +
                (preset === "custom" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground")
              }
            >
              Custom range
            </div>
            {summary && (
              <div className="mt-auto pt-2 px-3 text-xs text-muted-foreground border-t">
                <div className="font-medium text-foreground">{summary}</div>
              </div>
            )}
          </div>
          <RangeCalendar
            mode="range"
            min={1}
            numberOfMonths={2}
            defaultMonth={from ?? new Date()}
            startMonth={new Date(2000, 0)}
            endMonth={new Date()}
            selected={{ from, to: effectiveTo }}
            onSelect={handleSelect}
            disabled={{ after: new Date() }}
          />
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={goPrev}
        disabled={!canNav}
        className="p-1.5 rounded hover:bg-accent border border-transparent hover:border-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Previous period"
      >
        <ChevronLeft size={14} />
      </button>
      <button
        ref={btnRef}
        data-testid="date-range-trigger"
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors " +
          (open ? "border-primary bg-accent" : "bg-card hover:bg-accent")
        }
      >
        <Calendar size={13} className="text-muted-foreground shrink-0" />
        <span>{label}</span>
        {summary && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <span className="font-normal text-muted-foreground text-xs tabular-nums">{summary}</span>
          </>
        )}
        <ChevronDown size={12} className="text-muted-foreground ml-0.5" />
      </button>
      {popup}
      <button
        onClick={goNext}
        disabled={!canNav || !canGoNext}
        className="p-1.5 rounded hover:bg-accent border border-transparent hover:border-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Next period"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export interface RecordingsChartProps {
  cameraId?: number;
}

export default function RecordingsChart({ cameraId }: RecordingsChartProps) {
  const [preset, setPreset] = useState<PresetId>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

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
        <DateRangeSelector
          preset={preset}
          setPreset={setPreset}
          customFrom={customFrom}
          setCustomFrom={setCustomFrom}
          customTo={customTo}
          setCustomTo={setCustomTo}
        />
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
