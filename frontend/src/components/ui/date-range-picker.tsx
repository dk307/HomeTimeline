import { useState, useRef } from "react";
import { format, subDays } from "date-fns";
import type { RangeValue } from "@/components/Calendar";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import RangeCalendar from "@/components/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRangePreset {
  id: string;
  label: string;
  from: () => string;
  to: () => string;
}

const _todayStr = () => format(new Date(), "yyyy-MM-dd");
const _daysAgoStr = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

export const SHARED_PRESETS: DateRangePreset[] = [
  { id: "today",     label: "Today",         from: _todayStr,             to: _todayStr },
  { id: "yesterday", label: "Yesterday",      from: () => _daysAgoStr(1),  to: () => _daysAgoStr(1) },
  { id: "7d",        label: "Last 7 days",    from: () => _daysAgoStr(6),  to: _todayStr },
  { id: "14d",       label: "Last 14 days",   from: () => _daysAgoStr(13), to: _todayStr },
  { id: "30d",       label: "Last 30 days",   from: () => _daysAgoStr(29), to: _todayStr },
  { id: "60d",       label: "Last 60 days",   from: () => _daysAgoStr(59), to: _todayStr },
  { id: "90d",       label: "Last 90 days",   from: () => _daysAgoStr(89), to: _todayStr },
  { id: "180d",      label: "Last 180 days",  from: () => _daysAgoStr(179),to: _todayStr },
];

interface DateRangePickerProps {
  presets: DateRangePreset[];
  value: { preset: string; from: string; to: string };
  onChange: (preset: string, from: string, to: string) => void;
  maxSpanDays?: number;
  numberOfMonths?: number;
}

function fmtDisplay(from: string, to: string): string {
  if (!from) return "";
  const fromDate = new Date(from + "T00:00:00");
  const toDate = to ? new Date(to + "T00:00:00") : fromDate;
  if (format(fromDate, "yyyy-MM-dd") === format(toDate, "yyyy-MM-dd")) {
    return format(fromDate, "MMM d, yyyy");
  }
  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  return (
    format(fromDate, sameYear ? "MMM d" : "MMM d, yyyy") +
    " \u2013 " +
    format(toDate, "MMM d, yyyy")
  );
}

export function DateRangePicker({
  presets,
  value,
  onChange,
  maxSpanDays,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pendingRange, setPendingRange] = useState<RangeValue | undefined>();
  const listRef = useRef<HTMLDivElement>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setShowCalendar(false);
      setPendingRange(undefined);
    }
  }

  function selectPreset(preset: DateRangePreset) {
    onChange(preset.id, preset.from(), preset.to());
    handleOpenChange(false);
  }

  function openCalendar() {
    setPendingRange(
      value.from
        ? {
            from: new Date(value.from + "T00:00:00"),
            to: value.to ? new Date(value.to + "T00:00:00") : undefined,
          }
        : undefined,
    );
    setShowCalendar(true);
  }

  function handleCalendarSelect(range: RangeValue | undefined) {
    setPendingRange(range);
  }

  function applyCustomRange() {
    if (!pendingRange?.from) return;
    const from = format(pendingRange.from, "yyyy-MM-dd");
    const to = pendingRange.to
      ? format(pendingRange.to, "yyyy-MM-dd")
      : from;
    onChange("custom", from, to);
    handleOpenChange(false);
  }

  const displayLabel =
    value.preset === "custom" && value.from
      ? fmtDisplay(value.from, value.to)
      : presets.find((p) => p.id === value.preset)?.label ?? "Select range";

  const calendarSelected = showCalendar && pendingRange ? pendingRange : undefined;

  // endMonth is set one month ahead so the 2-month layout is always preserved.
  // disabled={{ after: new Date() }} still prevents selecting future dates.
  const now = new Date();
  const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors bg-card hover:bg-accent whitespace-nowrap"
          data-testid="date-range-trigger"
        >
          <CalendarIcon size={13} className="text-muted-foreground shrink-0" />
          <span className="truncate">{displayLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-fit p-0">
        {!showCalendar ? (
          <div ref={listRef} className="py-1" role="listbox" aria-label="Date range presets">
            {presets.map((p) => {
              const active = value.preset === p.id;
              return (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={active}
                  className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors ${active ? "bg-accent font-medium" : ""}`}
                  onClick={() => selectPreset(p)}
                >
                  <span className="w-4 shrink-0">{active && <Check size={14} />}</span>
                  {p.label}
                </button>
              );
            })}
            <div className="my-1 h-px bg-border" role="separator" />
            <button
              role="option"
              aria-selected={value.preset === "custom"}
              className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors ${value.preset === "custom" ? "bg-accent font-medium" : ""}`}
              onClick={openCalendar}
            >
              <span className="w-4 shrink-0">{value.preset === "custom" && <Check size={14} />}</span>
              Custom range…
            </button>
          </div>
        ) : (
          <div className="min-w-[580px]">
            <RangeCalendar
              mode="range"
              min={maxSpanDays ? undefined : 1}
              max={maxSpanDays ? maxSpanDays - 1 : undefined}
              numberOfMonths={numberOfMonths}
              defaultMonth={
                value.from ? new Date(value.from + "T00:00:00") : new Date()
              }
              startMonth={new Date(2000, 0)}
              endMonth={endMonth}
              selected={calendarSelected}
              onSelect={handleCalendarSelect}
              disabled={{ after: now }}
            />
            <div className="flex items-center justify-between px-3 py-2 border-t">
              <button
                onClick={() => setShowCalendar(false)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
              >
                Back
              </button>
              <button
                onClick={applyCustomRange}
                disabled={!pendingRange?.from}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
