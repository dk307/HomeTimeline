import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { subDays, differenceInCalendarDays, parseISO, format } from "date-fns";
import { fmtDt, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { Play, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, LayoutGrid, List, GripHorizontal, FileVideo } from "lucide-react";
import { recordingsApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import { formatBytes, formatDuration } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { DateRangePicker, SHARED_PRESETS } from "@/components/ui/date-range-picker";
import type { DateRangePreset } from "@/components/ui/date-range-picker";
import VideoPlayer from "@/components/VideoPlayer";

type PresetId = "all" | "today" | "yesterday" | "7d" | "14d" | "30d" | "60d" | "90d" | "180d" | "custom";
interface DateRangeSel { date?: string; days?: number; }
const todayStr   = () => format(new Date(), "yyyy-MM-dd");
const daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

const PRESETS: DateRangePreset[] = [
  { id: "all", label: "All time", from: () => "", to: () => "" },
  ...SHARED_PRESETS,
];

function presetToRange(id: PresetId, from: string, to: string): DateRangeSel {
  switch (id) {
    case "all":       return {};
    case "today":     return { date: todayStr(), days: 1 };
    case "yesterday": return { date: daysAgoStr(1), days: 1 };
    case "7d":        return { date: daysAgoStr(6), days: 7 };
    case "14d":       return { date: daysAgoStr(13), days: 14 };
    case "30d":       return { date: daysAgoStr(29), days: 30 };
    case "60d":       return { date: daysAgoStr(59), days: 60 };
    case "90d":       return { date: daysAgoStr(89), days: 90 };
    case "180d":      return { date: daysAgoStr(179), days: 180 };
    case "custom": {
      if (!from) return {};
      const end  = to || from;
      const diff = to ? differenceInCalendarDays(parseISO(end), parseISO(from)) + 1 : 1;
      return { date: from, days: Math.max(1, diff) };
    }
  }
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
            "group relative rounded-lg border overflow-hidden bg-card transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
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
  const { preset, setPreset, from: customFrom, setFrom: setCustomFrom, to: customTo, setTo: setCustomTo } =
    usePersistedDateRange("recordings-range", { preset: "7d", from: "", to: "", days: 7 });
  const [selectedCamera, setSelectedCamera] = useState<number | undefined>();
  const [playingId, setPlayingId]   = useState<number | null>(null);
  const [sortKey, setSortKey]       = useState<SortKey>("start_time");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [viewMode, setViewMode]     = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem("recordings-view");
      return stored === "list" || stored === "grid" ? stored : "grid";
    } catch { return "grid"; }
  });
  const [playerH, setPlayerH]       = useState(getSavedPlayerHeight);
  const recordingsScrollRef = useRef<HTMLDivElement>(null);

  const playRecording = useCallback((id: number) => {
    setPlayingId(prev => prev === id ? null : id);
  }, []);

  const tz = useTimezone();
  const range = presetToRange(preset as PresetId, customFrom, customTo);

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
    let lastH = playerH;

    function onMove(ev: MouseEvent) {
      lastH = Math.min(maxH, Math.max(MIN_PLAYER_H, startH + (ev.clientY - startY)));
      setPlayerH(lastH);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(PLAYER_H_KEY, String(lastH)); } catch {}
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [playerH]);

  const thClass = "text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap";

  const recordingsContent = viewMode === "grid" ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {isLoading && Array.from({ length: 6 }).map((_, i) => (
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="px-3 py-2.5 w-20"></th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Camera</th>
            <th className={thClass} role="button" tabIndex={0}
              aria-sort={sortKey === "start_time" ? sortDir === "asc" ? "ascending" : "descending" : "none"}
              onClick={() => toggleSort("start_time")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("start_time"); } }}
            >Date / Time <SortIcon col="start_time" sortKey={sortKey} sortDir={sortDir} /></th>
            <th className={thClass} role="button" tabIndex={0}
              aria-sort={sortKey === "duration_secs" ? sortDir === "asc" ? "ascending" : "descending" : "none"}
              onClick={() => toggleSort("duration_secs")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("duration_secs"); } }}
            >Duration <SortIcon col="duration_secs" sortKey={sortKey} sortDir={sortDir} /></th>
            <th className={thClass} role="button" tabIndex={0}
              aria-sort={sortKey === "file_size_bytes" ? sortDir === "asc" ? "ascending" : "descending" : "none"}
              onClick={() => toggleSort("file_size_bytes")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("file_size_bytes"); } }}
            >Size <SortIcon col="file_size_bytes" sortKey={sortKey} sortDir={sortDir} /></th>
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
      </div>
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
              <div className="flex items-center gap-1">
                <DateRangePicker
                  presets={PRESETS}
                  value={{ preset, from: customFrom, to: customTo }}
                  onChange={(p, f, t) => {
                    setPreset(p as PresetId);
                    setCustomFrom(f);
                    setCustomTo(t);
                  }}
                />
              </div>
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
              <ToggleGroup type="single" value={viewMode} onValueChange={(v) => {
                if (v) {
                  const mode = v as ViewMode;
                  setViewMode(mode);
                  try { localStorage.setItem("recordings-view", mode); } catch {}
                }
              }}>
                <ToggleGroupItem value="grid" title="Grid view" aria-label="Grid view">
                  <LayoutGrid size={15} />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" title="List view" aria-label="List view">
                  <List size={15} />
                </ToggleGroupItem>
              </ToggleGroup>
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
              role="separator"
              tabIndex={0}
              onMouseDown={startResize}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPlayerH(h => Math.min(Math.floor(window.innerHeight * 0.6), Math.max(MIN_PLAYER_H, h - 20)));
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPlayerH(h => Math.min(Math.floor(window.innerHeight * 0.6), Math.max(MIN_PLAYER_H, h + 20)));
                }
              }}
              className="flex items-center justify-center h-2 cursor-row-resize group -mb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
