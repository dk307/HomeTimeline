import { useMemo } from "react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import type { Matcher } from "react-day-picker";
import { addDays } from "date-fns";
import { cn } from "@/lib/utils";

export interface RangeValue {
  from?: Date;
  to?: Date;
}

export interface RangeCalendarProps {
  mode?: "range" | "single";
  min?: number;
  max?: number;
  numberOfMonths?: number;
  defaultMonth?: Date;
  startMonth?: Date;
  endMonth?: Date;
  selected?: RangeValue;
  onSelect?: (range: RangeValue | undefined) => void;
  disabled?: { after?: Date; before?: Date };
  className?: string;
  showOutsideDays?: boolean;
  [key: string]: unknown;
}

const dc = getDefaultClassNames();

export function RangeCalendar({
  mode = "range",
  min,
  max,
  numberOfMonths = 1,
  defaultMonth,
  startMonth,
  endMonth,
  selected,
  onSelect,
  disabled,
  className,
  showOutsideDays = true,
}: RangeCalendarProps) {
  const baseMaxDate = disabled?.after ?? endMonth;

  const effectiveMaxDate = useMemo(() => {
    if (max == null || !selected?.from) return baseMaxDate;
    const spanLimit = addDays(selected.from, max);
    if (!baseMaxDate) return spanLimit;
    return spanLimit < baseMaxDate ? spanLimit : baseMaxDate;
  }, [max, selected?.from, baseMaxDate]);

  const effectiveDisabled = useMemo(() => {
    const matchers: Matcher[] = [];
    if (disabled?.before) matchers.push({ before: disabled.before } as Matcher);
    if (effectiveMaxDate) matchers.push({ after: effectiveMaxDate } as Matcher);
    return matchers.length > 0 ? matchers : undefined;
  }, [disabled?.before, effectiveMaxDate]);

  return (
    <div className={cn("p-3", className)}>
      <DayPicker
        {...{ mode } as { mode: "range" }}
        selected={selected as never}
        onSelect={onSelect as never}
        defaultMonth={defaultMonth}
        numberOfMonths={numberOfMonths}
        pagedNavigation={numberOfMonths > 1}
        startMonth={startMonth}
        endMonth={endMonth}
        min={min}
        max={max}
        disabled={effectiveDisabled}
        showOutsideDays={showOutsideDays}
        classNames={{
          root: cn("w-fit", dc.root),
          months: cn("flex flex-col gap-4 md:flex-row", dc.months),
          month: cn("relative flex w-full flex-col gap-4", dc.month),
          nav: cn("absolute inset-x-0 top-0 flex items-center justify-between gap-1 z-10", dc.nav),
          button_previous: cn(
            "flex size-8 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
            dc.button_previous,
          ),
          button_next: cn(
            "flex size-8 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
            dc.button_next,
          ),
          month_caption: cn(
            "flex w-full items-center justify-center px-8 text-sm font-semibold",
            dc.month_caption,
          ),
          dropdowns: cn(
            "flex w-full items-center justify-center gap-1.5 text-sm font-medium",
            dc.dropdowns,
          ),
          month_grid: cn("w-full border-collapse", dc.month_grid),
          weekdays: cn("flex", dc.weekdays),
          weekday: cn(
            "flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none",
            dc.weekday,
          ),
          week: cn("mt-2 flex w-full", dc.week),
          day: cn(
            "group/day relative aspect-square h-full w-full p-0 text-center select-none",
            dc.day,
          ),
          range_start: cn("rounded-l-md bg-primary text-primary-foreground", dc.range_start),
          range_middle: cn("rounded-none", dc.range_middle),
          range_end: cn("rounded-r-md bg-primary text-primary-foreground", dc.range_end),
          today: cn("rounded-md bg-accent text-accent-foreground", dc.today),
          outside: cn(
            "text-muted-foreground aria-selected:text-muted-foreground",
            dc.outside,
          ),
          disabled: cn("text-muted-foreground opacity-50", dc.disabled),
          hidden: cn("invisible", dc.hidden),
          chevron: cn("[&>svg]:size-4", dc.chevron),
        }}
      />
    </div>
  );
}

export default RangeCalendar;
