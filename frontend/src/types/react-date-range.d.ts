declare module "react-date-range" {
  import { ComponentType, PureComponent, ReactNode } from "react";

  export interface Range {
    startDate?: Date;
    endDate?: Date;
    key?: string;
    color?: string;
    autoFocus?: boolean;
    disabled?: boolean;
  }

  export interface RangeKeyDict {
    [key: string]: Range;
  }

  export interface OnChangeProps {
    [key: string]: Range;
  }

  export interface DateRangeProps {
    ranges: Range[];
    onChange?: (ranges: OnChangeProps) => void;
    months?: number;
    direction?: "horizontal" | "vertical";
    minDate?: Date;
    maxDate?: Date;
    moveRangeOnFirstSelection?: boolean;
    retainEndDateOnFirstSelection?: boolean;
    disabledDates?: Date[];
    focusedRange?: number[];
    onRangeFocusChange?: (focusedRange: number[]) => void;
    showDateDisplay?: boolean;
    showMonthAndYearPickers?: boolean;
    showMonthArrow?: boolean;
    showPreview?: boolean;
    editableDateInputs?: boolean;
    dragSelectionEnabled?: boolean;
    rangeColors?: string[];
    className?: string;
    dateDisplayFormat?: string;
    locale?: object;
    scroll?: { enabled?: boolean };
    fixedHeight?: boolean;
    displayMode?: "dateRange" | "date";
    onPreviewChange?: (preview?: Range) => void;
    preview?: Range;
    navigatorRenderer?: (currentFocusDate: Date, changeShownDate: (date: Date) => void, props: any) => ReactNode;
  }

  export class DateRange extends PureComponent<DateRangeProps> {}

  export interface CalendarProps extends Omit<DateRangeProps, "onChange" | "ranges"> {
    date?: Date;
    onChange?: (date: Date) => void;
    color?: string;
  }

  export class Calendar extends PureComponent<CalendarProps> {}
}
