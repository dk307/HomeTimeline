import { useRef } from "react";
import { DateRange as RdrDateRange } from "react-date-range";
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
  mode = "range",
  numberOfMonths = 1,
  defaultMonth,
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

  function handleChange(item: Record<string, { startDate?: Date; endDate?: Date }>) {
    const sel = Object.values(item)[0];
    if (!onSelect || !sel) return;

    const startDate = sel.startDate;
    const endDate = sel.endDate;
    if (!startDate) return;

    const isSameDay = !endDate || startDate.getTime() === endDate.getTime();

    if (isSameDay) {
      onSelect({ from: startDate });
    } else {
      onSelect({ from: startDate, to: endDate });
    }
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
        minDate={startMonth}
        maxDate={disabled?.after ?? endMonth}
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
