declare module "@wojtekmaj/react-daterange-picker/dist/entry.nostyle" {
  import { CalendarProps } from "react-calendar";
  export type DateRangePickerCalendarProps = Omit<
    CalendarProps,
    "calendarClassName" | "onChange" | "value"
  > & {
    calendarClassName?: string;
    onChange: (value: [Date, Date]) => void;
    value: [Date, Date];
    clearIcon: import("react").JSX.Element | null;
    calendarIcon: import("react").JSX.Element | null;
    rangeDivider: import("react").JSX.Element | null;
    disabled?: boolean | null;
    nextLabel?: import("react").JSX.Element | null;
    prevLabel?: import("react").JSX.Element | null;
  };
  export default function DateRangePicker(props: DateRangePickerCalendarProps): import("react").JSX.Element;
}
