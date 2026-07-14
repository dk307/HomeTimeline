import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { format, addDays, parseISO, differenceInCalendarDays, subDays } from "date-fns";
import {
  ArrowLeft,
  Clock,
  Download,
  HardDrive,
  Loader,
  RefreshCw,
  Square,
  Trash2,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { camerasApi, type Camera } from "@/api/cameras";
import { recordingsApi, timelineApi } from "@/api/recordings";
import { cn, formatBytes, formatDuration, toErrorMessage } from "@/lib/utils";
import { clipSequence, neighborRecordingId } from "@/lib/timeline";
import { fmtDt, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import VideoPlayer from "@/components/VideoPlayer";
import VideoStream from "@/components/VideoStream";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DatePicker,
  MAX_SPAN_DAYS,
  PRESETS,
  ZOOM_LEVELS,
  tickInterval,
  tickLabel,
  type PresetId,
} from "@/components/TimelineControls";

const ACTIVITY_DAYS = 30;

/* ---------------------------------------------------------------- stat cards */

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-4">
      <div className="p-2 rounded-md bg-primary/10">
        <Icon size={20} className="text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- activity combo chart */

function ActivityChart({ cameraId }: { cameraId: number }) {
  const { data: daily } = useQuery({
    queryKey: ["recordings-daily", ACTIVITY_DAYS, cameraId],
    queryFn: () => recordingsApi.dailyCounts(ACTIVITY_DAYS, cameraId),
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
        <h2 className="text-sm font-semibold">Recording activity</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {totalCount.toLocaleString()} clips · {formatDuration(totalSecs)} over {ACTIVITY_DAYS} days
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
                      <p>{point.count} clip{point.count === 1 ? "" : "s"}</p>
                    )}
                    {point?.secs != null && (
                      <p>Total length: {formatDuration(point.secs)}</p>
                    )}
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

/* -------------------------------------------------------- single-camera timeline */

function CameraTimeline({ cameraId }: { cameraId: number }) {
  const [selectedDate, setSelectedDate] = useState(() => format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [days, setDays] = useState(7);
  const [zoom, setZoom] = useState(1);
  const [preset, setPreset] = useState<PresetId>("7d");
  const [selectedRecordingId, setSelectedRecordingId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: segments, isLoading } = useQuery({
    queryKey: ["timeline", selectedDate, days, cameraId],
    queryFn: ({ signal }) => timelineApi.get(selectedDate, days, [cameraId], signal),
  });

  function applyPreset(p: typeof PRESETS[number]) {
    setPreset(p.id);
    if (p.id !== "custom") {
      setSelectedDate(p.date());
      setDays(p.days);
    }
  }
  function goPrev() {
    setPreset("custom");
    setSelectedDate(format(subDays(parseISO(selectedDate), days), "yyyy-MM-dd"));
  }
  function goNext() {
    setPreset("custom");
    setSelectedDate(format(addDays(parseISO(selectedDate), days), "yyyy-MM-dd"));
  }
  function onSelectRange(f: Date, t: Date) {
    setPreset("custom");
    setSelectedDate(format(f, "yyyy-MM-dd"));
    setDays(Math.min(differenceInCalendarDays(t, f) + 1, MAX_SPAN_DAYS));
  }

  const zoomIn = () => {
    const i = ZOOM_LEVELS.indexOf(zoom);
    if (i < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[i + 1]);
  };
  const zoomOut = () => {
    const i = ZOOM_LEVELS.indexOf(zoom);
    if (i > 0) setZoom(ZOOM_LEVELS[i - 1]);
  };

  const startDate = parseISO(selectedDate);
  const endDate = addDays(startDate, days - 1);
  const totalHours = days * 24;
  const rangeMs = totalHours * 3600000;
  const rangeStart = startDate.getTime();

  const interval = tickInterval(zoom);
  const ticks: number[] = [];
  for (let h = 0; h <= totalHours; h += interval) ticks.push(h);

  const segs = segments ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold">Timeline</h2>
        <div className="flex items-center gap-3">
          <DatePicker
            preset={preset}
            from={startDate}
            to={endDate}
            onApplyPreset={applyPreset}
            onSelectRange={onSelectRange}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div className="flex items-center gap-1 border rounded px-1">
            <button onClick={zoomOut} disabled={zoom === ZOOM_LEVELS[0]} className="p-1 hover:bg-accent rounded disabled:opacity-40">
              <ZoomOut size={14} />
            </button>
            <span className="text-xs w-8 text-center">{zoom}x</span>
            <button
              onClick={zoomIn}
              disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              className="p-1 hover:bg-accent rounded disabled:opacity-40"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto overflow-hidden" ref={scrollRef}>
          <div style={{ minWidth: zoom * 100 + "%" }}>
            <div className="flex border-b bg-muted/50">
              <div className="flex-1 relative h-7">
                {ticks.map((h) => (
                  <span
                    key={h}
                    className="absolute flex items-center text-xs text-muted-foreground leading-tight whitespace-nowrap"
                    style={{ left: (h / totalHours) * 100 + "%", transform: "translateX(-50%)" }}
                  >
                    {tickLabel(h, zoom, startDate)}
                  </span>
                ))}
              </div>
            </div>

            {isLoading && <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>}

            {!isLoading && (
              <div className="flex border-b last:border-0">
                <div className="flex-1 relative h-16 my-auto">
                  {ticks.slice(1).map((h) => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 border-l border-border/30"
                      style={{ left: (h / totalHours) * 100 + "%" }}
                    />
                  ))}
                  {segs.map((seg) => {
                    const segStart = new Date(seg.start_time).getTime();
                    const segEnd = new Date(seg.end_time).getTime();
                    const left = ((segStart - rangeStart) / rangeMs) * 100;
                    const width = Math.max(((segEnd - segStart) / rangeMs) * 100, 0.1);
                    const isSel = selectedRecordingId === seg.recording_id;
                    const clampedL = Math.max(0, left);
                    const clampedW = Math.min(width, 100 - clampedL);
                    const thumbName = seg.thumbnail_path ? seg.thumbnail_path.split(/[\\/]/).pop() : null;
                    const thumbUrl = thumbName && clampedW * zoom > 0.5 ? `/thumbnails/${thumbName}` : null;
                    return (
                      <button
                        key={seg.recording_id}
                        onClick={() => setSelectedRecordingId(isSel ? null : seg.recording_id)}
                        title={
                          format(new Date(seg.start_time), "MM/dd HH:mm") +
                          (seg.duration_secs ? " · " + Math.round(seg.duration_secs / 60) + "m" : "")
                        }
                        className={
                          "absolute top-1 bottom-1 rounded overflow-hidden transition-all border " +
                          (isSel
                            ? "border-primary ring-2 ring-primary ring-offset-1 bg-primary/40"
                            : "border-primary/30 bg-primary/50 hover:bg-primary/70")
                        }
                        style={{
                          left: clampedL + "%",
                          width: clampedW + "%",
                          ...(thumbUrl
                            ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                            : {}),
                        }}
                      />
                    );
                  })}
                  {segs.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                      No recordings in this range.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRecordingId && (() => {
        const { ids, index } = clipSequence(segs, selectedRecordingId);
        const prevId = neighborRecordingId(segs, selectedRecordingId, -1);
        const nextId = neighborRecordingId(segs, selectedRecordingId, 1);
        return (
          <div className="rounded-lg border bg-card overflow-hidden">
            <VideoPlayer
              recordingId={selectedRecordingId}
              onClose={() => setSelectedRecordingId(null)}
              onPrev={prevId != null ? () => setSelectedRecordingId(prevId) : undefined}
              onNext={nextId != null ? () => setSelectedRecordingId(nextId) : undefined}
              position={index >= 0 ? { index: index + 1, total: ids.length } : undefined}
            />
          </div>
        );
      })()}
    </div>
  );
}

/* --------------------------------------------------------------- commands panel */

function CommandsPanel({ cameraId, cameraName }: { cameraId: number; cameraName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reindex = useMutation({
    mutationFn: () => camerasApi.reindex(cameraId),
    onMutate: () => {
      setReindexing(true);
      setError(null);
    },
    onError: (e) => setError(`Reindex failed: ${toErrorMessage(e)}`),
    onSuccess: () => toast("Reindex started", { description: `Reindexing "${cameraName}".` }),
    onSettled: () => {
      setReindexing(false);
      qc.invalidateQueries({ queryKey: ["camera-stats", cameraId] });
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });

  const dropIndex = useMutation({
    mutationFn: () => camerasApi.dropIndex(cameraId),
    onMutate: () => setError(null),
    onError: (e) => setError(`Drop index failed: ${toErrorMessage(e)}`),
    onSuccess: () => {
      toast("Index dropped", { description: `Recording index for "${cameraName}" has been cleared.` });
      qc.invalidateQueries({ queryKey: ["camera-stats", cameraId] });
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });

  async function onReindex() {
    const ok = await confirm({
      title: `Reindex "${cameraName}"?`,
      message: "All indexed recordings will be dropped and reindexed from scratch.",
      confirmLabel: "Reindex",
    });
    if (!ok) return;
    reindex.mutate();
  }
  async function onDrop() {
    const ok = await confirm({
      title: `Drop index for "${cameraName}"?`,
      message: "All indexed recording records will be deleted. Video files are kept.",
      confirmLabel: "Drop Index",
      destructive: true,
    });
    if (!ok) return;
    dropIndex.mutate();
  }

  const btn =
    "flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors";

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold mb-3">Commands</h2>
      {confirmDialog}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button onClick={onReindex} disabled={reindexing} className={btn + " hover:bg-accent disabled:opacity-50"}>
          {reindexing ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Reindex
        </button>
        <button
          onClick={onDrop}
          disabled={dropIndex.isPending}
          className={btn + " border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"}
        >
          <Trash2 size={14} />
          Drop Index
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive mt-3">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-3">
        Reindex re-scans this camera's recording path; Drop Index removes indexed records only (video files are
        untouched). Use "Purge Old Videos" above to permanently delete clips older than the configured retention age.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- scan button */

function ScanButton({ cameraId }: { cameraId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prevRunning = useRef(false);
  // Stopping is cooperative (not instant): show a "Stopping…" state until the
  // scan actually halts. Poll faster meanwhile so the button reverts promptly.
  const [stopping, setStopping] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["scan-status", cameraId],
    queryFn: () => camerasApi.scanStatus(cameraId),
    refetchInterval: stopping ? 1000 : 3000,
  });

  const running = !!status?.running;
  useEffect(() => {
    if (prevRunning.current && !running) {
      // A scan just finished — refresh this camera's stats, chart, and timeline.
      qc.invalidateQueries({ queryKey: ["camera-stats", cameraId] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    }
    prevRunning.current = running;
  }, [running, cameraId, qc]);
  // Clear the local stopping state once the scan has actually halted.
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const scan = useMutation({
    mutationFn: () => camerasApi.scan(cameraId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scan-status", cameraId] });
      toast("Scan started", { description: `Camera #${cameraId} scan in progress.` });
    },
    onError: (e) => toast("Scan failed", { description: toErrorMessage(e), variant: "error" }),
  });
  const stop = useMutation({
    mutationFn: () => camerasApi.stopScan(cameraId),
    onMutate: () => setStopping(true),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scan-status", cameraId] }),
  });

  if (running) {
    return (
      <button
        onClick={() => stop.mutate()}
        disabled={stopping || stop.isPending}
        title="Stop the running scan"
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
      >
        {stopping ? (
          <Loader size={13} className="animate-spin" />
        ) : (
          <Square size={13} className="fill-current" />
        )}
        {stopping ? "Stopping…" : "Stop Scan"}
      </button>
    );
  }

  return (
    <button
      onClick={() => scan.mutate()}
      disabled={scan.isPending}
      title="Scan this camera's recording path for new files"
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
    >
      <RefreshCw size={14} />
      Scan Disk
    </button>
  );
}

/* ----------------------------------------------------------- download button */

function DownloadButton({ cameraId }: { cameraId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prevRunning = useRef(false);
  // Stopping is cooperative (not instant) — see ScanButton.
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["download-status", cameraId],
    queryFn: () => camerasApi.downloadStatus(cameraId),
    refetchInterval: stopping ? 1000 : 3000,
  });

  const running = !!status?.running;
  useEffect(() => {
    if (prevRunning.current && !running) {
      // A download just finished — refresh this camera's stats, chart, timeline.
      qc.invalidateQueries({ queryKey: ["camera-stats", cameraId] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["download-events", cameraId] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    }
    prevRunning.current = running;
  }, [running, cameraId, qc]);
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const download = useMutation({
    mutationFn: () => camerasApi.download(cameraId),
    onMutate: () => setError(null),
    onError: (e) => setError(`Download failed: ${toErrorMessage(e)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["download-status", cameraId] });
      toast("Download started", { description: `Camera #${cameraId} download in progress.` });
    },
  });
  const stop = useMutation({
    mutationFn: () => camerasApi.stopDownload(cameraId),
    onMutate: () => {
      setStopping(true);
      setError(null);
    },
    onError: (e) => {
      setStopping(false);
      setError(`Stop failed: ${toErrorMessage(e)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["download-status", cameraId] }),
  });

  return (
    <div className="flex items-center gap-2">
      {running ? (
        <button
          onClick={() => stop.mutate()}
          disabled={stopping || stop.isPending}
          title="Stop the running download"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
        >
          {stopping ? (
            <Loader size={13} className="animate-spin" />
          ) : (
            <Square size={13} className="fill-current" />
          )}
          {stopping ? "Stopping…" : "Stop Download"}
        </button>
      ) : (
        <button
          onClick={() => download.mutate()}
          disabled={download.isPending}
          title="Download new clips from this Hikvision camera"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <Download size={14} />
          Download Videos
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- purge button */

function PurgeButton({ camera }: { camera: Camera }) {
  const cameraId = camera.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const prevRunning = useRef(false);
  // Stopping is cooperative (not instant) — see ScanButton/DownloadButton.
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No retention window configured → nothing to purge; disable the action.
  const retention = camera.purge_older_than_days;
  const configured = retention != null && retention > 0;

  const { data: status } = useQuery({
    queryKey: ["purge-status", cameraId],
    queryFn: () => camerasApi.purgeStatus(cameraId),
    refetchInterval: stopping ? 1000 : 3000,
  });

  const running = !!status?.running;
  useEffect(() => {
    if (prevRunning.current && !running) {
      // A purge just finished — refresh this camera's stats, chart, timeline.
      qc.invalidateQueries({ queryKey: ["camera-stats", cameraId] });
      qc.invalidateQueries({ queryKey: ["recordings-daily"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      qc.invalidateQueries({ queryKey: ["storage-stats"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    }
    prevRunning.current = running;
  }, [running, cameraId, qc]);
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const purge = useMutation({
    mutationFn: () => camerasApi.purge(cameraId),
    onError: (e) => setError(`Purge failed: ${toErrorMessage(e)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purge-status", cameraId] });
      toast("Purge started", { description: `Purging old clips for "${camera.name}".` });
    },
  });
  const stop = useMutation({
    mutationFn: () => camerasApi.stopPurge(cameraId),
    onMutate: () => {
      setStopping(true);
      setError(null);
    },
    onError: (e) => {
      setStopping(false);
      setError(`Stop failed: ${toErrorMessage(e)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purge-status", cameraId] }),
  });

  async function onPurge() {
    const ok = await confirm({
      title: `Purge "${camera.name}"?`,
      message: `Delete all clips older than ${retention} day${retention === 1 ? "" : "s"}. Video files, thumbnails, and index entries are permanently removed.`,
      confirmLabel: "Purge",
      destructive: true,
    });
    if (!ok) return;
    purge.mutate();
  }

  return (
    <div className="flex items-center gap-2">
      {confirmDialog}
      {running ? (
        <button
          onClick={() => stop.mutate()}
          disabled={stopping || stop.isPending}
          title="Stop the running purge"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
        >
          {stopping ? (
            <Loader size={13} className="animate-spin" />
          ) : (
            <Square size={13} className="fill-current" />
          )}
          {stopping ? "Stopping…" : "Stop Purge"}
        </button>
      ) : (
        <button
          onClick={onPurge}
          disabled={purge.isPending || !configured}
          title={
            configured
              ? `Delete clips older than ${retention} days`
              : "Set a retention age (Purge old videos) in the camera settings first"
          }
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 disabled:opacity-50 transition-colors"
        >
          <Trash2 size={14} />
          Purge Old Videos
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------- device info (Hikvision) */

function DeviceInfoCard({ cameraId }: { cameraId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["device-info", cameraId],
    queryFn: () => camerasApi.deviceInfo(cameraId),
    retry: false,
  });

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold mb-3">Camera Details</h2>
      {isLoading && <p className="text-sm text-muted-foreground">Loading device info…</p>}
      {data && !data.available && (
        <p className="text-sm text-muted-foreground">
          Camera unavailable{data.error ? `: ${data.error}` : ""}.
        </p>
      )}
      {data && (data.available || data.rtsp_url) && (
        <div className="space-y-3 text-sm">
          {data.available && data.info && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {Object.entries(data.info).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono truncate">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {(data.rtsp_url || data.snapshot_url) && (
            <div className="space-y-1 border-t pt-2">
              {data.rtsp_url && (
                <p className="font-mono text-xs break-all">
                  <span className="text-muted-foreground">RTSP: </span>
                  {data.rtsp_url}
                </p>
              )}
              {data.snapshot_url && (
                <p className="font-mono text-xs break-all">
                  <span className="text-muted-foreground">Snapshot: </span>
                  {data.snapshot_url}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- live view */

function LiveView({ cameraId }: { cameraId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["streams", cameraId],
    queryFn: () => camerasApi.streams(cameraId),
    retry: false,
    staleTime: 60_000,
  });
  // Default to the sub stream for Hikvision or the first stream for Aqura:
  // Hikvision sub is H.264 and plays natively/smoothly. The main stream is often
  // 4K H.265, which the browser can't decode over WebRTC, so it is transcoded on
  // demand by ffmpeg (heavier) when the user switches to it.
  const [quality, setQuality] = useState<string>(() => {
    try { return localStorage.getItem(`cameraDetail.channel.${cameraId}`) ?? "sub"; } catch { return "sub"; }
  });

  const streams = data?.streams ?? [];
  const selected = streams.find((s) => s.quality === quality) ?? streams[0];

  // When the data loads, set the default quality to the first available stream
  // unless the stored quality is still valid.
  const defaultSet = useRef(false);
  useEffect(() => {
    if (streams.length > 0 && !defaultSet.current) {
      defaultSet.current = true;
      if (!streams.some((s) => s.quality === quality)) {
        setQuality(streams[0].quality);
      }
    }
  }, [streams]);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Live View</h2>
        {data?.available && streams.length > 1 && (
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {streams.map((s) => (
              <button
                key={s.quality}
                onClick={() => {
                setQuality(s.quality);
                try { localStorage.setItem(`cameraDetail.channel.${cameraId}`, s.quality); } catch {}
              }}
                className={cn(
                  "px-2.5 py-1 rounded transition-colors",
                  selected?.quality === s.quality
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="aspect-video w-full rounded-md border border-dashed bg-muted/30 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader size={20} className="animate-spin" />
          <p className="text-sm">Preparing live view…</p>
        </div>
      )}
      {isError && (
        <div className="aspect-video w-full rounded-md border border-dashed bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Video size={28} />
          <p className="text-sm">Couldn't load live view. Please try again.</p>
        </div>
      )}
      {!isError && data && !data.available && (
        <div className="aspect-video w-full rounded-md border border-dashed bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Video size={28} />
          <p className="text-sm">{data.reason ?? "Live view unavailable"}</p>
        </div>
      )}
      {!isError && selected && <VideoStream key={selected.name} streamName={selected.name} />}
    </div>
  );
}

/* --------------------------------------------------------------- page */

export default function CameraDetail() {
  const { id } = useParams<{ id: string }>();
  const cameraId = Number(id);
  const navigate = useNavigate();
  const tz = useTimezone();

  const { data: cameras } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list() });
  const camera = cameras?.find((c) => c.id === cameraId);
  const isHikvision = camera?.camera_type === "hikvision";
  const isAqura = camera?.camera_type === "aqura";
  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["camera-stats", cameraId],
    queryFn: () => camerasApi.stats(cameraId),
    enabled: Number.isFinite(cameraId),
  });

  if (isError || !Number.isFinite(cameraId)) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/cameras" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Cameras
        </Link>
        <p className="text-sm text-muted-foreground">Camera not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/cameras"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} /> Cameras
          </Link>
          <h1 className="text-2xl font-bold">{stats?.name ?? (isLoading ? "…" : "Camera")}</h1>
          {stats && !stats.enabled && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Disabled</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ScanButton cameraId={cameraId} />
          {isHikvision && <DownloadButton cameraId={cameraId} />}
          {isHikvision && camera && <PurgeButton camera={camera} />}
          {cameras && cameras.length > 1 && (
            <select
              aria-label="Switch camera"
              value={cameraId}
              onChange={(e) => navigate(`/cameras/${e.target.value}`)}
              className="text-sm rounded-md border bg-card px-2 py-1.5"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Live view sits at the top — always visible above the tabs. */}
      {isHikvision || isAqura ? (
        <LiveView cameraId={cameraId} />
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Live View</h2>
          <div className="aspect-video w-full rounded-md border border-dashed bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Video size={28} />
            <p className="text-sm">Live view is available for Hikvision and Aqura cameras only.</p>
          </div>
        </div>
      )}

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">
            <Clock size={14} /> Timeline
          </TabsTrigger>
          <TabsTrigger value="details">
            <Video size={14} /> Details
          </TabsTrigger>
          <TabsTrigger value="commands">
            <RefreshCw size={14} /> Commands
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Recordings" value={stats ? stats.total_recordings.toLocaleString() : "—"} icon={Video} />
            <StatCard label="Total Clip Length" value={stats ? formatDuration(stats.total_duration_secs) : "—"} icon={Clock} />
            <StatCard
              label="Last Video"
              value={stats?.last_video_at ? fmtDt(stats.last_video_at, tz, FMT_DATETIME_SHORT) : "Never"}
              icon={Video}
            />
            <StatCard label="Indexed Size" value={stats ? formatBytes(stats.indexed_size_bytes) : "—"} icon={HardDrive} />
            {isHikvision && (
              <StatCard
                label="Last Downloaded"
                value={stats?.last_downloaded_at ? fmtDt(stats.last_downloaded_at, tz, FMT_DATETIME_SHORT) : "Never"}
                icon={Download}
              />
            )}
          </div>
          {Number.isFinite(cameraId) && <ActivityChart cameraId={cameraId} />}
          {Number.isFinite(cameraId) && <CameraTimeline cameraId={cameraId} />}
        </TabsContent>

        <TabsContent value="details" className="mt-4">
          {isHikvision ? (
            <DeviceInfoCard cameraId={cameraId} />
          ) : isAqura ? (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">Aqura Camera</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Stream URL 1</dt>
                <dd className="font-mono truncate">{camera?.stream_url_1 ?? "—"}</dd>
                <dt className="text-muted-foreground">Stream URL 2</dt>
                <dd className="font-mono truncate">{camera?.stream_url_2 ?? "—"}</dd>
                <dt className="text-muted-foreground">Stream URL 3</dt>
                <dd className="font-mono truncate">{camera?.stream_url_3 ?? "—"}</dd>
                <dt className="text-muted-foreground">RTSP Username</dt>
                <dd className="font-mono truncate">{camera?.aqura_username ?? "—"}</dd>
                <dt className="text-muted-foreground">Recording Path</dt>
                <dd className="font-mono truncate">{camera?.recording_path}</dd>
              </dl>
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              This is a generic camera. Device details are available for Hikvision and Aqura cameras.
            </div>
          )}
        </TabsContent>

        <TabsContent value="commands" className="mt-4">
          {Number.isFinite(cameraId) && (
            <CommandsPanel cameraId={cameraId} cameraName={stats?.name ?? "this camera"} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
