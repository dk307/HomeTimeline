import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { subDays, addDays, differenceInCalendarDays, parseISO, format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { fmtDt, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { Play, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Calendar, LayoutGrid, List, GripHorizontal, FileVideo } from "lucide-react";
import { recordingsApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import { formatBytes, formatDuration } from "@/lib/utils";
import RangeCalendar from "@/components/Calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import VideoPlayer from "@/components/VideoPlayer";

type PresetId = "all" | "today" | "yesterday" | "7d" | "30d" | "custom";
interface DateRangeSel { date?: string; days?: number; }
const todayStr   = () => format(new Date(), "yyyy-MM-dd");
const daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "all",       label: "All time"     },
  { id: "today",     label: "Today"        },
  { id: "yesterday", label: "Yesterday"    },
  { id: "7d",        label: "Last 7 days"  },
  { id: "30d",       label: "Last 30 days" },
];

function presetToRange(id: PresetId, from: string, to: string): DateRangeSel {
  switch (id) {
    case "all":       return {};
    case "today":     return { date: todayStr(), days: 1 };
    case "yesterday": return { date: daysAgoStr(1), days: 1 };
    case "7d":        return { date: daysAgoStr(6), days: 7 };
    case "30d":       return { date: daysAgoStr(29), days: 30 };
    case "custom": {
      if (!from) return {};
      const end  = to || from;
      const diff = to ? differenceInCalendarDays(parseISO(end), parseISO(from)) + 1 : 1;
      return { date: from, days: Math.max(1, diff) };
    }
  }
}

function effectiveRange(preset: PresetId, from: string, to: string): { from?: Date; to?: Date } {
  const r = presetToRange(preset, from, to);
  if (!r.date) return {};
  const start = parseISO(r.date);
  return { from: start, to: addDays(start, (r.days ?? 1) - 1) };
}

function rangeLabel(preset: PresetId, customFrom: string, customTo: string): string {
  const { from, to } = effectiveRange(preset, customFrom, customTo);
  if (!from || !to) return "";
  if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) return format(from, "MMM d, yyyy");
  const sameYear = from.getFullYear() === to.getFullYear();
  return format(from, sameYear ? "MMM d" : "MMM d, yyyy") + " – " + format(to, "MMM d, yyyy");
}

interface DatePickerProps {
  preset: PresetId; setPreset: (p: PresetId) => void;
  customFrom: string; setCustomFrom: (s: string) => void;
  customTo: string;   setCustomTo: (s: string) => void;
}

function DateRangePicker({ preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    setOpen(v => !v);
  }

  const canNav = preset !== "all";

  function goPrev() {
    if (!canNav) return;
    const { from, to } = effectiveRange(preset, customFrom, customTo);
    if (!from || !to) return;
    const days = differenceInCalendarDays(to, from) + 1;
    const newFrom = format(subDays(from, days), "yyyy-MM-dd");
    const newTo   = format(subDays(to, days), "yyyy-MM-dd");
    setPreset("custom");
    setCustomFrom(newFrom);
    setCustomTo(newTo);
  }

  function goNext() {
    if (!canNav) return;
    const { from, to } = effectiveRange(preset, customFrom, customTo);
    if (!from || !to) return;
    const days = differenceInCalendarDays(to, from) + 1;
    const newFrom = format(addDays(from, days), "yyyy-MM-dd");
    const newTo   = format(addDays(to, days), "yyyy-MM-dd");
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

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) return;
    setPreset("custom");
    setCustomFrom(format(range.from, "yyyy-MM-dd"));
    setCustomTo(format(range.to ?? range.from, "yyyy-MM-dd"));
    if (range.to) setOpen(false);
  }

  const label   = PRESETS.find(p => p.id === preset)?.label ?? "Custom range";
  const summary = rangeLabel(preset, customFrom, customTo);
  const { from, to } = effectiveRange(preset, customFrom, customTo);

  const popup = open ? createPortal(
    <div
      ref={popRef}
      className="fixed z-50 w-max rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden flex"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex flex-col p-1.5 gap-0.5 border-r bg-muted/30 min-w-[9rem]">
        {PRESETS.map((p) => (
          <button key={p.id}
            onClick={() => applyPreset(p.id)}
            className={"w-full text-left px-3 py-1.5 rounded text-sm transition-colors whitespace-nowrap " + (preset === p.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground")}>
            {p.label}
          </button>
        ))}
        <div className={"mt-0.5 px-3 py-1.5 rounded text-sm whitespace-nowrap " + (preset === "custom" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>
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
        selected={{ from, to }}
        onSelect={handleSelect}
        disabled={{ after: new Date() }}
      />
    </div>,
    document.body
  ) : null;

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
        onClick={toggleOpen}
        className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors " + (open ? "border-primary bg-accent" : "bg-card hover:bg-accent")}
      >
        <Calendar size={13} className="text-muted-foreground shrink-0" />
        <span>{label}</span>
        {summary && <><span className="text-muted-foreground/40">|</span><span className="font-normal text-muted-foreground text-xs tabular-nums">{summary}</span></>}
        <ChevronDown size={12} className="text-muted-foreground ml-0.5" />
      </button>
      {popup}
      <button
        onClick={goNext}
        disabled={!canNav}
        className="p-1.5 rounded hover:bg-accent border border-transparent hover:border-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Next period"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

type SortKey = "start_time" | "duration_secs" | "file_size_bytes";
type SortDir = "asc" | "desc";
type ViewMode = "grid" | "list";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="inline ml-1 opacity-30" />;
  return sortDir === "asc" ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />;
}

function GridCard({
  r,
  cam,
  tz,
  playingId,
  onPlay,
}: {
  r: { id: number; camera_id: number; thumbnail_path: string | null; start_time: string; duration_secs: number | null; file_size_bytes: number | null; status: string };
  cam: { name: string } | undefined;
  tz: string;
  playingId: number | null;
  onPlay: (id: number) => void;
}) {
  const camName = cam?.name ?? "cam-" + r.camera_id;
  const dt = fmtDt(r.start_time, tz, FMT_DATETIME_SHORT);
  const dur = formatDuration(r.duration_secs);
  const size = r.file_size_bytes ? formatBytes(r.file_size_bytes) : "-";
  const isActive = playingId === r.id;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => onPlay(r.id)}
          data-rec-id={r.id}
          className={
            "group relative rounded-lg border overflow-hidden bg-card transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer text-left focus:outline-none focus:ring-0 " +
            (isActive ? "ring-2 ring-primary shadow-md shadow-primary/20" : "")
          }
        >
          <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
            {r.thumbnail_path ? (
              <>
                <img
                  src={"/thumbnails/" + r.thumbnail_path.split(/[\\/]/).pop()}
                  alt=""
                  className="w-full h-full object-cover"
                />
                {isActive && (
                  <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                    <div className="bg-primary/90 rounded-full p-2">
                      <Play size={16} className="text-primary-foreground fill-primary-foreground" />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <FileVideo size={24} className="text-muted-foreground/40" />
            )}
          </div>
          <div className="px-2 py-1.5 flex items-center justify-between gap-1">
            <span className="text-xs font-medium truncate">{camName}</span>
            {r.status !== "ready" && (
              <span title={"Status: " + r.status}>
                <AlertTriangle size={12} className="text-yellow-500 shrink-0" />
              </span>
            )}
          </div>
          <span className="absolute bottom-8 right-1.5 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded tabular-nums">
            {dur}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <div className="font-medium">{camName}</div>
          <div className="text-muted-foreground">{dt}</div>
          <div className="flex gap-3 text-muted-foreground">
            <span>{dur}</span>
            <span>{size}</span>
          </div>
          {r.status !== "ready" && (
            <div className="text-yellow-500">Status: {r.status}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const PAGE_SIZE = 200;
const DEFAULT_PLAYER_H = 360;
const MIN_PLAYER_H = 180;
const PLAYER_H_KEY = "recordings-player-height";

function getSavedPlayerHeight(): number {
  try { return Number(localStorage.getItem(PLAYER_H_KEY)) || DEFAULT_PLAYER_H; } catch { return DEFAULT_PLAYER_H; }
}

export default function Recordings() {
  const [preset, setPreset]         = useState<PresetId>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  const [selectedCamera, setSelectedCamera] = useState<number | undefined>();
  const [playingId, setPlayingId]   = useState<number | null>(null);
  const [sortKey, setSortKey]       = useState<SortKey>("start_time");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [viewMode, setViewMode]     = useState<ViewMode>("grid");
  const [playerH, setPlayerH]       = useState(getSavedPlayerHeight);
  const recordingsScrollRef = useRef<HTMLDivElement>(null);

  const playRecording = useCallback((id: number) => {
    setPlayingId(prev => prev === id ? null : id);
  }, []);

  const tz = useTimezone();
  const range = presetToRange(preset, customFrom, customTo);

  const { data: cameras } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list() });

  const {
    data: pagesData,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["recordings", range.date, range.days, selectedCamera],
    queryFn: ({ pageParam = 0 }) =>
      recordingsApi.list({ date: range.date, days: range.days, camera_id: selectedCamera, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.recordings.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const recordings = useMemo(
    () => pagesData?.pages.flatMap((p) => p.recordings) ?? [],
    [pagesData],
  );
  const total = pagesData?.pages[0]?.total ?? 0;

  const gridSentinelRef = useRef<HTMLDivElement>(null);
  const listSentinelRef = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const container = recordingsScrollRef.current;
    if (!container) return;
    const el = viewMode === "grid" ? gridSentinelRef.current : listSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore();
    }, { root: container, rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, recordings.length, viewMode]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => {
    return [...recordings].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "start_time") {
        av = new Date(a.start_time).getTime(); bv = new Date(b.start_time).getTime();
      } else if (sortKey === "duration_secs") {
        av = a.duration_secs ?? 0; bv = b.duration_secs ?? 0;
      } else {
        av = a.file_size_bytes ?? 0; bv = b.file_size_bytes ?? 0;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [recordings, sortKey, sortDir]);

  const currentIdx = useMemo(
    () => playingId != null ? sorted.findIndex(r => r.id === playingId) : -1,
    [playingId, sorted],
  );

  const goPrev = useCallback(() => {
    if (currentIdx > 0) { setPlayingId(sorted[currentIdx - 1].id); }
  }, [currentIdx, sorted]);

  const goNext = useCallback(() => {
    if (currentIdx >= 0 && currentIdx < sorted.length - 1) { setPlayingId(sorted[currentIdx + 1].id); }
  }, [currentIdx, sorted]);

  useEffect(() => {
    if (playingId == null) return;
    const el = document.querySelector(`[data-rec-id="${playingId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [playingId]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = playerH;
    const maxH = Math.floor(window.innerHeight * 0.6);

    function onMove(ev: MouseEvent) {
      const newH = Math.min(maxH, Math.max(MIN_PLAYER_H, startH + (ev.clientY - startY)));
      setPlayerH(newH);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(PLAYER_H_KEY, String(playerH)); } catch {}
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [playerH]);

  const thClass = "text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap";

  const recordingsContent = viewMode === "grid" ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {isLoading && Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card overflow-hidden animate-pulse">
          <div className="aspect-video bg-muted" />
          <div className="px-2 py-1.5"><div className="h-3 bg-muted rounded w-1/2" /></div>
        </div>
      ))}
      {!isLoading && sorted.length === 0 && (
        <div className="col-span-full px-4 py-8 text-center text-muted-foreground">No recordings found.</div>
      )}
      {sorted.map((r) => (
        <GridCard
          key={r.id}
          r={r}
          cam={cameras?.find((c) => c.id === r.camera_id)}
          tz={tz}
          playingId={playingId}
          onPlay={playRecording}
        />
      ))}
      <div ref={gridSentinelRef} className="col-span-full" />
      {isFetchingNextPage && (
        <div className="col-span-full flex justify-center py-4">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  ) : (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="px-3 py-2.5 w-20"></th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Camera</th>
            <th className={thClass} onClick={() => toggleSort("start_time")}>Date / Time <SortIcon col="start_time" sortKey={sortKey} sortDir={sortDir} /></th>
            <th className={thClass} onClick={() => toggleSort("duration_secs")}>Duration <SortIcon col="duration_secs" sortKey={sortKey} sortDir={sortDir} /></th>
            <th className={thClass} onClick={() => toggleSort("file_size_bytes")}>Size <SortIcon col="file_size_bytes" sortKey={sortKey} sortDir={sortDir} /></th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>}
          {!isLoading && !sorted.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No recordings found.</td></tr>}
          {sorted.map((r) => {
            const cam = cameras?.find((c) => c.id === r.camera_id);
            return (
              <tr key={r.id} data-rec-id={r.id} className={"hover:bg-muted/30 transition-colors " + (playingId === r.id ? "bg-primary/10 border-l-2 border-l-primary" : "")}>
                <td className="px-3 py-2 w-20">
                  {r.thumbnail_path && (
                    <img
                      src={"/thumbnails/" + r.thumbnail_path.split(/[\\/]/).pop()}
                      alt=""
                      className={"w-20 h-12 object-cover rounded border cursor-pointer transition-all " + (playingId === r.id ? "ring-2 ring-primary" : "")}
                      onClick={() => playRecording(r.id)}
                    />
                  )}
                </td>
                <td className="px-4 py-2.5 font-medium">
                  <span className="flex items-center gap-1.5">
                    {cam?.name ?? "cam-" + r.camera_id}
                    {r.status !== "ready" && <span title={"Status: " + r.status}><AlertTriangle size={13} className="text-yellow-500 shrink-0" /></span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">{fmtDt(r.start_time, tz, FMT_DATETIME_SHORT)}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatDuration(r.duration_secs)}</td>
                <td className="px-4 py-2.5 tabular-nums">{r.file_size_bytes ? formatBytes(r.file_size_bytes) : "-"}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => playRecording(r.id)} className={"p-1 rounded transition-colors " + (playingId === r.id ? "bg-primary text-primary-foreground" : "hover:bg-accent")} title={playingId === r.id ? "Close" : "Play"}>
                    <Play size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
          {isFetchingNextPage && (
            <tr><td colSpan={6} className="px-4 py-4 text-center">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            </td></tr>
          )}
        </tbody>
      </table>
      <div ref={listSentinelRef} />
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full">
        <div className="shrink-0 px-6 pt-6 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Recordings</h1>
              {total > 0 && <span className="text-sm text-muted-foreground tabular-nums">{sorted.length} / {total}</span>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DateRangePicker preset={preset} setPreset={setPreset} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />
              <Select
                value={selectedCamera != null ? String(selectedCamera) : "all"}
                onValueChange={(v) => setSelectedCamera(v === "all" ? undefined : Number(v))}
              >
                <SelectTrigger className="min-w-[9rem]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cameras</SelectItem>
                  {cameras?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center border rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode("grid")}
                  className={"p-1.5 transition-colors " + (viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent text-muted-foreground")}
                  title="Grid view"
                  aria-label="Grid view"
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={"p-1.5 transition-colors " + (viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent text-muted-foreground")}
                  title="List view"
                  aria-label="List view"
                >
                  <List size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {playingId && (
          <div className="shrink-0 px-6" data-testid="video-player-wrapper">
            <div
              className="rounded-lg border bg-card overflow-hidden relative"
              style={{ height: playerH }}
            >
              <VideoPlayer recordingId={playingId} onClose={() => setPlayingId(null)} onPrev={currentIdx > 0 ? goPrev : undefined} onNext={currentIdx < sorted.length - 1 ? goNext : undefined} />
            </div>
            <div
              onMouseDown={startResize}
              className="flex items-center justify-center h-2 cursor-row-resize group -mb-1"
              title="Drag to resize player"
              data-testid="resize-handle"
            >
              <GripHorizontal size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            </div>
          </div>
        )}

        <div ref={recordingsScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {recordingsContent}
        </div>
      </div>
    </TooltipProvider>
  );
}
