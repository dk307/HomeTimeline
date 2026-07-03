import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { format, subDays, differenceInCalendarDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import RangeCalendar from "@/components/Calendar";

// Backend caps the timeline query at 90 days.
export const MAX_SPAN_DAYS = 90;
export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];

export const todayStr = () => format(new Date(), "yyyy-MM-dd");
export const daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

export type PresetId = "today" | "yesterday" | "7d" | "30d" | "custom";

export const PRESETS: { id: PresetId; label: string; date: () => string; days: number }[] = [
  { id: "today",     label: "Today",        date: todayStr,             days: 1  },
  { id: "yesterday", label: "Yesterday",    date: () => daysAgoStr(1),  days: 1  },
  { id: "7d",        label: "Last 7 days",  date: () => daysAgoStr(6),  days: 7  },
  { id: "30d",       label: "Last 30 days", date: () => daysAgoStr(29), days: 30 },
  { id: "custom",    label: "Custom",       date: todayStr,             days: 1  },
];

export function fmtRange(from: Date, to: Date): string {
  if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) return format(from, "MMM d, yyyy");
  const sameYear = from.getFullYear() === to.getFullYear();
  return format(from, sameYear ? "MMM d" : "MMM d, yyyy") + " – " + format(to, "MMM d, yyyy");
}

export function tickInterval(zoom: number): number {
  if (zoom <= 1)  return 24;
  if (zoom <= 2)  return 12;
  if (zoom <= 4)  return 6;
  if (zoom <= 8)  return 3;
  if (zoom <= 16) return 1;
  return 0.5;
}

export function tickLabel(hourOffset: number, zoom: number, startDate: Date): string {
  const date = new Date(startDate.getTime() + hourOffset * 3600000);
  if (zoom <= 1) return format(date, "MM/dd");
  if (zoom <= 4) return format(date, "MM/dd HH:mm");
  return format(date, "HH:mm");
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

export function DatePicker({ preset, from, to, onApplyPreset, onSelectRange, onPrev, onNext }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    setOpen(v => !v);
  }

  // Position the portal under the trigger, clamped into the viewport so the wide
  // (preset rail + two months) popup is never squeezed against a screen edge.
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
      className="fixed z-[100] w-max rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden flex"
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
        max={MAX_SPAN_DAYS - 1}
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
