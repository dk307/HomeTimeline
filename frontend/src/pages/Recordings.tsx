import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { subDays, addDays, differenceInCalendarDays, parseISO, format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { fmtDt, FMT_DATETIME_SHORT } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { Play, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, Calendar } from "lucide-react";
import { recordingsApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import { formatBytes, formatDuration } from "@/lib/utils";
import RangeCalendar from "@/components/Calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/** Effective {from,to} Dates for the current selection, for the calendar + summary. */
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

  // Position the portal under the trigger, clamped into the viewport. The popup
  // is wide (preset rail + two months); a plain `left` on a right-edge trigger
  // would let the browser shrink it to the remaining width and squish/wrap it.
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
      className="fixed z-[100] w-max rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden flex"
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
    <>
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
    </>
  );
}

type SortKey = "start_time" | "duration_secs" | "file_size_bytes";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="inline ml-1 opacity-30" />;
  return sortDir === "asc" ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />;
}

export default function Recordings() {
  const [preset, setPreset]         = useState<PresetId>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  const [selectedCamera, setSelectedCamera] = useState<number | undefined>();
  const [playingId, setPlayingId]   = useState<number | null>(null);
  const [sortKey, setSortKey]       = useState<SortKey>("start_time");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");

  const tz = useTimezone();
  const range = presetToRange(preset, customFrom, customTo);

  const { data: cameras } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list() });
  const { data: recordings, isLoading } = useQuery({
    queryKey: ["recordings", range.date, range.days, selectedCamera],
    queryFn: () => recordingsApi.list({ date: range.date, days: range.days, camera_id: selectedCamera }),
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => {
    if (!recordings) return [];
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

  const thClass = "text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Recordings</h1>
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
        </div>
      </div>

      {playingId && <div className="rounded-lg border bg-card overflow-hidden"><VideoPlayer recordingId={playingId} /></div>}

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
                <tr key={r.id} className={"hover:bg-muted/30 transition-colors " + (playingId === r.id ? "bg-primary/5" : "")}>
                  <td className="px-3 py-2 w-20">
                    {r.thumbnail_path && (
                      <img
                        src={"/thumbnails/" + r.thumbnail_path.split(/[\\/]/).pop()}
                        alt=""
                        className="w-20 h-12 object-cover rounded border cursor-pointer"
                        onClick={() => setPlayingId(playingId === r.id ? null : r.id)}
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
                    <button onClick={() => setPlayingId(playingId === r.id ? null : r.id)} className="p-1 rounded hover:bg-accent" title={playingId === r.id ? "Close" : "Play"}>
                      <Play size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
