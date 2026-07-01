import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, differenceInCalendarDays, parseISO } from "date-fns";
import { Play, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown, Calendar } from "lucide-react";
import { recordingsApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import { formatBytes, formatDuration } from "@/lib/utils";
import VideoPlayer from "@/components/VideoPlayer";

type PresetId = "all" | "today" | "yesterday" | "7d" | "30d" | "custom";
interface DateRange { date?: string; days?: number; }
const todayStr   = () => format(new Date(), "yyyy-MM-dd");
const daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "all",       label: "All time"     },
  { id: "today",     label: "Today"        },
  { id: "yesterday", label: "Yesterday"    },
  { id: "7d",        label: "Last 7 days"  },
  { id: "30d",       label: "Last 30 days" },
  { id: "custom",    label: "Custom range" },
];

function presetToRange(id: PresetId, from: string, to: string): DateRange {
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

function rangeLabel(preset: PresetId, customFrom: string, customTo: string): string {
  switch (preset) {
    case "all":       return "";
    case "today":     return todayStr();
    case "yesterday": return daysAgoStr(1);
    case "7d":        return daysAgoStr(6) + " -> " + todayStr();
    case "30d":       return daysAgoStr(29) + " -> " + todayStr();
    case "custom":
      if (!customFrom) return "pick dates";
      if (!customTo || customFrom === customTo) return customFrom;
      return customFrom + " -> " + customTo;
  }
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
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen(v => !v);
  }

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

  const label   = PRESETS.find(p => p.id === preset)?.label ?? preset;
  const summary = rangeLabel(preset, customFrom, customTo);

  const popup = open ? createPortal(
    <div
      ref={popRef}
      className="fixed z-50 rounded-lg border bg-popover shadow-lg overflow-hidden flex"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex flex-col p-1.5 gap-0.5 border-r">
        {PRESETS.map((p) => (
          <button key={p.id}
            onClick={() => { setPreset(p.id); if (p.id !== "custom") setOpen(false); }}
            className={"w-full text-left px-3 py-1.5 rounded text-sm transition-colors whitespace-nowrap " + (preset === p.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground")}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex flex-col gap-3 p-4 min-w-[190px]">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</label>
            <input type="date" value={customFrom} max={customTo || todayStr()} onChange={(e) => setCustomFrom(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</label>
            <input type="date" value={customTo} min={customFrom} max={todayStr()} onChange={(e) => setCustomTo(e.target.value)} className="text-sm border rounded px-2 py-1.5 bg-background" />
          </div>
          <div className="flex gap-2 pt-1">
            {(customFrom || customTo) && (
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); }} className="flex-1 text-xs border rounded px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors">Clear</button>
            )}
            {customFrom && (
              <button onClick={() => setOpen(false)} className="flex-1 text-xs bg-primary text-primary-foreground rounded px-2 py-1.5 hover:bg-primary/90 transition-colors">Apply</button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
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
          <select value={selectedCamera ?? ""} onChange={(e) => setSelectedCamera(e.target.value ? Number(e.target.value) : undefined)} className="text-sm border rounded px-2 py-1.5 bg-background">
            <option value="">All cameras</option>
            {cameras?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {playingId && <div className="rounded-lg border bg-card overflow-hidden"><VideoPlayer recordingId={playingId} /></div>}

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Camera</th>
              <th className={thClass} onClick={() => toggleSort("start_time")}>Date / Time <SortIcon col="start_time" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thClass} onClick={() => toggleSort("duration_secs")}>Duration <SortIcon col="duration_secs" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thClass} onClick={() => toggleSort("file_size_bytes")}>Size <SortIcon col="file_size_bytes" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>}
            {!isLoading && !sorted.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No recordings found.</td></tr>}
            {sorted.map((r) => {
              const cam = cameras?.find((c) => c.id === r.camera_id);
              const dt  = new Date(r.start_time);
              return (
                <tr key={r.id} className={"hover:bg-muted/30 transition-colors " + (playingId === r.id ? "bg-primary/5" : "")}>
                  <td className="px-4 py-2.5 font-medium">
                    <span className="flex items-center gap-1.5">
                      {cam?.name ?? "cam-" + r.camera_id}
                      {r.status !== "ready" && <span title={"Status: " + r.status}><AlertTriangle size={13} className="text-yellow-500 shrink-0" /></span>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">{format(dt, "yyyy-MM-dd HH:mm:ss")}</td>
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
