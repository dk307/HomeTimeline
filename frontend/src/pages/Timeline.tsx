import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, subDays, parseISO, differenceInCalendarDays } from "date-fns";
import type { DateRange } from "react-day-picker";

import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, ChevronDown } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { timelineApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import RangeCalendar from "@/components/Calendar";
import VideoPlayer from "@/components/VideoPlayer";

const MAX_SPAN_DAYS = 90; // backend caps the timeline query at 90 days

const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];
const todayStr   = () => format(new Date(), "yyyy-MM-dd");
const daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

type PresetId = "today" | "yesterday" | "7d" | "30d" | "custom";

const PRESETS: { id: PresetId; label: string; date: () => string; days: number }[] = [
  { id: "today",     label: "Today",        date: todayStr,             days: 1  },
  { id: "yesterday", label: "Yesterday",    date: () => daysAgoStr(1),  days: 1  },
  { id: "7d",        label: "Last 7 days",  date: () => daysAgoStr(6),  days: 7  },
  { id: "30d",       label: "Last 30 days", date: () => daysAgoStr(29), days: 30 },
  { id: "custom",    label: "Custom",       date: todayStr,             days: 1  },
];

function fmtRange(from: Date, to: Date): string {
  if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) return format(from, "MMM d, yyyy");
  const sameYear = from.getFullYear() === to.getFullYear();
  return format(from, sameYear ? "MMM d" : "MMM d, yyyy") + " – " + format(to, "MMM d, yyyy");
}

interface DatePickerProps {
  preset: PresetId;
  from: Date;
  to: Date;
  onApplyPreset: (p: typeof PRESETS[number]) => void;
  onSelectRange: (from: Date, to: Date) => void;
  onPrev: () => void;
  onNext: () => void;
}

function DatePicker({ preset, from, to, onApplyPreset, onSelectRange, onPrev, onNext }: DatePickerProps) {
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

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) return;
    // Live-apply as the range is built: first click sets the start (span 1),
    // second click completes the range and closes the popover.
    onSelectRange(range.from, range.to ?? range.from);
    if (range.to) setOpen(false);
  }

  const label   = PRESETS.find(p => p.id === preset)?.label ?? "Custom";
  const days    = differenceInCalendarDays(to, from) + 1;

  const popup = open ? createPortal(
    <div
      ref={popRef}
      className="fixed z-[100] rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden flex"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex flex-col p-1.5 gap-0.5 border-r bg-muted/30 min-w-[9rem]">
        {PRESETS.filter((p) => p.id !== "custom").map((p) => (
          <button
            key={p.id}
            onClick={() => { onApplyPreset(p); setOpen(false); }}
            className={"w-full text-left px-3 py-1.5 rounded text-sm transition-colors whitespace-nowrap " + (preset === p.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground")}
          >
            {p.label}
          </button>
        ))}
        <div className="mt-auto pt-2 px-3 text-xs text-muted-foreground border-t">
          <div className="font-medium text-foreground">{fmtRange(from, to)}</div>
          <div className="tabular-nums">{days} day{days === 1 ? "" : "s"}</div>
        </div>
      </div>
      <RangeCalendar
        mode="range"
        min={1}
        numberOfMonths={2}
        defaultMonth={from}
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
      <button onClick={onPrev} className="p-1.5 rounded hover:bg-accent border border-transparent hover:border-border transition-colors" title="Previous period">
        <ChevronLeft size={14} />
      </button>

      <button
        ref={btnRef}
        onClick={toggleOpen}
        className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors " + (open ? "border-primary bg-accent" : "bg-card hover:bg-accent")}
      >
        <Calendar size={13} className="text-muted-foreground shrink-0" />
        <span>{label}</span>
        <span className="text-muted-foreground/40">|</span>
        <span className="font-normal text-muted-foreground text-xs tabular-nums">{fmtRange(from, to)}</span>
        <ChevronDown size={12} className="text-muted-foreground ml-0.5" />
      </button>

      {popup}

      <button onClick={onNext} className="p-1.5 rounded hover:bg-accent border border-transparent hover:border-border transition-colors" title="Next period">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function tickInterval(zoom: number): number {
  if (zoom <= 1)  return 24;
  if (zoom <= 2)  return 12;
  if (zoom <= 4)  return 6;
  if (zoom <= 8)  return 3;
  if (zoom <= 16) return 1;
  return 0.5;
}

function tickLabel(hourOffset: number, zoom: number, startDate: Date): string {
  const date = new Date(startDate.getTime() + hourOffset * 3600000);
  if (zoom <= 1) return format(date, "MM/dd");
  if (zoom <= 4) return format(date, "MM/dd HH:mm");
  return format(date, "HH:mm");
}

export default function Timeline() {
  const { selectedDate, setSelectedDate, selectedRecordingId, setSelectedRecording } = useUIStore();
  const [days, setDays]     = useState(7);
  const [zoom, setZoom]     = useState(1);
  const [preset, setPreset] = useState<PresetId>("7d");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedDate) setSelectedDate(daysAgoStr(6));
  }, []);

  const { data: cameras } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list(true) });
  const { data: segments, isLoading } = useQuery({
    queryKey: ["timeline", selectedDate, days],
    queryFn: () => timelineApi.get(selectedDate, days),
    enabled: !!selectedDate,
  });

  function applyPreset(p: typeof PRESETS[number]) {
    setPreset(p.id);
    if (p.id !== "custom") { setSelectedDate(p.date()); setDays(p.days); }
  }
  function goPrev() { setPreset("custom"); if (selectedDate) setSelectedDate(format(subDays(parseISO(selectedDate), days), "yyyy-MM-dd")); }
  function goNext() { setPreset("custom"); if (selectedDate) setSelectedDate(format(addDays(parseISO(selectedDate), days), "yyyy-MM-dd")); }
  function onSelectRange(f: Date, t: Date) {
    setPreset("custom");
    setSelectedDate(format(f, "yyyy-MM-dd"));
    setDays(Math.min(differenceInCalendarDays(t, f) + 1, MAX_SPAN_DAYS));
  }

  const zoomIn  = () => { const i = ZOOM_LEVELS.indexOf(zoom); if (i < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[i + 1]); };
  const zoomOut = () => { const i = ZOOM_LEVELS.indexOf(zoom); if (i > 0) setZoom(ZOOM_LEVELS[i - 1]); };

  const startDate  = selectedDate ? parseISO(selectedDate) : new Date();
  const endDate    = addDays(startDate, days - 1);
  const totalHours = days * 24;
  const rangeMs    = totalHours * 3600000;
  const rangeStart = startDate.getTime();

  const byCamera = cameras?.map((cam) => ({
    camera: cam,
    segments: (segments ?? []).filter((s) => s.camera_id === cam.id),
  }));

  const interval = tickInterval(zoom);
  const ticks: number[] = [];
  for (let h = 0; h <= totalHours; h += interval) ticks.push(h);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Timeline</h1>
        <div className="flex items-center gap-1 border rounded px-1">
          <button onClick={zoomOut} disabled={zoom === ZOOM_LEVELS[0]} className="p-1 hover:bg-accent rounded disabled:opacity-40"><ZoomOut size={14} /></button>
          <span className="text-xs w-8 text-center">{zoom}x</span>
          <button onClick={zoomIn} disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} className="p-1 hover:bg-accent rounded disabled:opacity-40"><ZoomIn size={14} /></button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <DatePicker
          preset={preset}
          from={startDate}
          to={endDate}
          onApplyPreset={applyPreset}
          onSelectRange={onSelectRange}
          onPrev={goPrev}
          onNext={goNext}
        />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto overflow-hidden" ref={scrollRef}>
          <div style={{ minWidth: zoom * 100 + "%" }}>
            <div className="flex border-b bg-muted/50 sticky top-0 z-10">
              <div className="w-36 flex-shrink-0 px-3 py-1 text-xs text-muted-foreground font-medium">Camera</div>
              <div className="flex-1 relative h-7">
                {ticks.map((h) => (
                  <span key={h} className="absolute flex items-center text-xs text-muted-foreground leading-tight whitespace-nowrap" style={{ left: (h / totalHours * 100) + "%", transform: "translateX(-50%)" }}>
                    {tickLabel(h, zoom, startDate)}
                  </span>
                ))}
              </div>
            </div>

            {isLoading && <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>}
            {!isLoading && !selectedDate && <div className="p-8 text-center text-muted-foreground text-sm">Select a date above to view the timeline.</div>}

            {byCamera?.map(({ camera, segments: segs }) => (
              <div key={camera.id} className="flex border-b last:border-0 hover:bg-muted/20">
                <div className="w-36 flex-shrink-0 px-3 flex items-center text-sm font-medium truncate sticky left-0 bg-card z-10 border-r">{camera.name}</div>
                <div className="flex-1 relative h-16 my-auto">
                  {ticks.slice(1).map((h) => (
                    <div key={h} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: (h / totalHours * 100) + "%" }} />
                  ))}
                  {segs.map((seg) => {
                    const segStart  = new Date(seg.start_time).getTime();
                    const segEnd    = new Date(seg.end_time).getTime();
                    const left      = ((segStart - rangeStart) / rangeMs) * 100;
                    const width     = Math.max(((segEnd - segStart) / rangeMs) * 100, 0.1);
                    const isSel     = selectedRecordingId === seg.recording_id;
                    const clampedL  = Math.max(0, left);
                    const clampedW  = Math.min(width, 100 - clampedL);
                    const thumbName = seg.thumbnail_path ? seg.thumbnail_path.split(/[\\/]/).pop() : null;
                    const thumbUrl  = thumbName && clampedW * zoom > 0.5 ? `/thumbnails/${thumbName}` : null;
                    return (
                      <button
                        key={seg.recording_id}
                        onClick={() => setSelectedRecording(isSel ? null : seg.recording_id)}
                        title={format(new Date(seg.start_time), "MM/dd HH:mm") + (seg.duration_secs ? " · " + Math.round(seg.duration_secs / 60) + "m" : "")}
                        className={"absolute top-1 bottom-1 rounded overflow-hidden transition-all border " + (isSel ? "border-primary ring-2 ring-primary ring-offset-1 bg-primary/40" : "border-primary/30 bg-primary/50 hover:bg-primary/70")}
                        style={{
                          left: clampedL + "%",
                          width: clampedW + "%",
                          ...(thumbUrl ? {
                            backgroundImage: `url(${thumbUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          } : {}),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            {byCamera?.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">No cameras configured.</div>}
          </div>
        </div>
      </div>

      {selectedRecordingId && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <VideoPlayer recordingId={selectedRecordingId} />
        </div>
      )}
    </div>
  );
}
