import "react-day-picker/style.css";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Theme-aware wrapper around react-day-picker. The `ht-cal` class is targeted
 * in index.css to map react-day-picker's CSS variables onto the shadcn theme
 * tokens, so the calendar matches light/dark automatically. Pass any DayPicker
 * prop through (mode, selected, onSelect, numberOfMonths, disabled, …).
 */
export function Calendar({ className, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("ht-cal", className)}
      {...props}
    />
  );
}

export default Calendar;
