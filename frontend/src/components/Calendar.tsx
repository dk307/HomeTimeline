import { useRef, useMemo } from "react";
import { DateRange as RdrDateRange } from "react-date-range";
import { addDays, differenceInCalendarDays } from "date-fns";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
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

export function RangeCalendar({
  min,
  max,
  numberOfMonths = 1,
  startMonth,
  endMonth,
  selected,
  onSelect,
  disabled,
  className,
}: RangeCalendarProps) {
  const focusedRangeRef = useRef([0, 0]);

  const ranges = [
    {
      startDate: selected?.from ?? new Date(),
      endDate: selected?.to ?? selected?.from ?? new Date(),
      key: "selection",
    },
  ];

  const minDate = disabled?.before ?? startMonth;

  const baseMaxDate = disabled?.after ?? endMonth;

  const effectiveMaxDate = useMemo(() => {
    if (max == null || !selected?.from) return baseMaxDate;
    const spanLimit = addDays(selected.from, max);
    if (!baseMaxDate) return spanLimit;
    return spanLimit < baseMaxDate ? spanLimit : baseMaxDate;
  }, [max, selected?.from, baseMaxDate]);

  function handleChange(item: Record<string, { startDate?: Date; endDate?: Date }>) {
    const sel = Object.values(item)[0];
    if (!onSelect || !sel) return;

    const startDate = sel.startDate;
    const endDate = sel.endDate;
    if (!startDate) return;

    const isSameDay = !endDate || startDate.getTime() === endDate.getTime();

    if (isSameDay) {
      onSelect({ from: startDate });
      return;
    }

    let from = startDate;
    let to = endDate;

    if (min != null || max != null) {
      const span = differenceInCalendarDays(to, from);
      if (max != null && span > max) to = addDays(from, max);
      if (min != null && span < min) to = addDays(from, min);
    }

    onSelect({ from, to });
  }

  function handleFocusChange(fr: number[]) {
    focusedRangeRef.current = fr;
  }

  return (
    <div className={cn("ht-rdr", className)}>
      <RdrDateRange
        ranges={ranges}
        onChange={handleChange}
        months={numberOfMonths}
        direction="horizontal"
        minDate={minDate}
        maxDate={effectiveMaxDate}
        moveRangeOnFirstSelection={false}
        onRangeFocusChange={handleFocusChange}
        showDateDisplay={false}
        showMonthAndYearPickers={false}
        rangeColors={["hsl(var(--primary))"]}
      />
    </div>
  );
}

export default RangeCalendar;
