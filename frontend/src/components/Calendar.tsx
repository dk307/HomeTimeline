import { useMemo } from "react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import type { Matcher } from "react-day-picker";
import { cn } from "@/lib/utils";

export interface RangeValue {
  from?: Date;
  to?: Date;
}

interface RangeCalendarProps {
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
  const disabledMatchers = useMemo(() => {
    const matchers: Matcher[] = [];
    if (disabled?.before) matchers.push({ before: disabled.before } as Matcher);
    if (disabled?.after) matchers.push({ after: disabled.after } as Matcher);
    return matchers.length > 0 ? matchers : undefined;
  }, [disabled?.before, disabled?.after]);

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
        disabled={disabledMatchers}
        showOutsideDays={showOutsideDays}
        classNames={{
          root: cn(dc.root, "min-w-0"),
          months: cn(dc.months, "flex flex-col gap-4 md:flex-row"),
          month: cn(dc.month, "relative flex w-full flex-col gap-4"),
          nav: cn(dc.nav, "absolute inset-x-0 top-0 flex items-center justify-between gap-1 z-10"),
          button_previous: cn(
            dc.button_previous,
            "flex size-8 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&>svg]:fill-current",
          ),
          button_next: cn(
            dc.button_next,
            "flex size-8 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 [&>svg]:fill-current",
          ),
          month_caption: cn(
            dc.month_caption,
            "flex w-full items-center justify-center px-8 text-sm font-semibold",
          ),
          dropdowns: cn(
            dc.dropdowns,
            "flex w-full items-center justify-center gap-1.5 text-sm font-medium",
          ),
          month_grid: cn(dc.month_grid, "w-full border-collapse"),
          weekdays: cn(dc.weekdays, "flex"),
          weekday: cn(
            dc.weekday,
            "flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none",
          ),
          week: cn(dc.week, "mt-2 flex w-full"),
          day: cn(
            dc.day,
            "group/day relative aspect-square h-full w-full p-0 text-center select-none",
          ),
          range_start: cn(dc.range_start, "rounded-l-md bg-primary text-primary-foreground"),
          range_middle: cn(dc.range_middle, "rounded-none bg-primary/15"),
          range_end: cn(dc.range_end, "rounded-r-md bg-primary text-primary-foreground"),
          today: cn(dc.today, "rounded-md bg-accent text-accent-foreground"),
          outside: cn(
            dc.outside,
            "text-muted-foreground aria-selected:text-muted-foreground",
          ),
          disabled: cn(dc.disabled, "text-muted-foreground opacity-50"),
          hidden: cn(dc.hidden, "invisible"),
          chevron: cn(dc.chevron, "[&>svg]:size-4"),
        }}
      />
    </div>
  );
}

export default RangeCalendar;
