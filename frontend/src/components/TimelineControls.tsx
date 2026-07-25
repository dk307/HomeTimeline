import { format, subDays } from "date-fns";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { DateRangePreset } from "@/components/ui/date-range-picker";
import { SHARED_PRESETS } from "@/components/ui/date-range-picker";

// Backend caps the timeline query at 90 days.
export const MAX_SPAN_DAYS = 90;
export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];

export const daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

interface TimelinePreset extends DateRangePreset {
  date: () => string;
  days: number;
}

export type PresetId = typeof PRESETS[number]["id"];

export const PRESETS: TimelinePreset[] = SHARED_PRESETS.map((p) => {
  const days = p.id === "today" ? 1 : p.id === "yesterday" ? 1 :
    parseInt(p.id) || 1;
  return { ...p, date: p.from, days };
}).filter((p) => {
  if (p.id === "today" || p.id === "yesterday") return true;
  return (parseInt(p.id) || 0) <= MAX_SPAN_DAYS;
});

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
}

export function DatePicker({ preset, from, to, onApplyPreset, onSelectRange }: DatePickerProps) {
  return (
    <DateRangePicker
      presets={PRESETS.filter(p => p.id !== "custom")}
      value={{
        preset,
        from: format(from, "yyyy-MM-dd"),
        to: format(to, "yyyy-MM-dd"),
      }}
      onChange={(p, f, t) => {
        const preset = PRESETS.find(pr => pr.id === p);
        if (preset) onApplyPreset(preset);
        if (f && t) onSelectRange(new Date(f + "T00:00:00"), new Date(t + "T00:00:00"));
      }}
      maxSpanDays={MAX_SPAN_DAYS}
    />
  );
}
