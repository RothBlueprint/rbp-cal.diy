import type { Dayjs } from "@calcom/dayjs";
import { Icon } from "@calcom/ui/components/icon";
import type { ReactNode } from "react";

import { rbpZoneName } from "../lib/rbpZoneName";

/**
 * rbp: the appointment as a raised sheet: the chosen day as a tile (the same
 * look as the picked chip in the day strip), the date, the time range and the
 * zone, then the video-call line. Shared by the confirm form (BookEventForm)
 * and the booked page (RbpBookedCard), so the pick reads the same at every step.
 */
export const RbpAppointmentSheet = ({
  start,
  end,
  timezone,
  timeFormat,
  heading,
  action,
  showVideoLine = true,
  children,
}: {
  start: Dayjs;
  end: Dayjs;
  timezone: string;
  timeFormat: string;
  heading: string;
  action?: ReactNode;
  showVideoLine?: boolean;
  children?: ReactNode;
}) => (
  <section
    aria-label={heading}
    className="bg-default rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0)_60%)] p-4 text-left ring-1 ring-black/5 shadow-[0_1px_2px_rgba(60,45,20,0.10),0_16px_32px_-16px_rgba(60,45,20,0.40)] dark:ring-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_6px_rgba(0,0,0,0.4),0_22px_44px_-18px_rgba(0,0,0,0.85)]">
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-subtle text-xs font-medium">{heading}</span>
      {action}
    </div>
    <div className="flex items-center gap-4">
      <div
        aria-hidden="true"
        className="bg-brand-default text-brand flex min-h-[68px] w-[60px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl tabular-nums shadow-[0_6px_14px_-6px_color-mix(in_srgb,var(--cal-brand)_60%,transparent)]">
        <span className="text-xs font-medium opacity-80">{start.format("ddd")}</span>
        <span className="text-xl font-semibold leading-tight">{start.format("D")}</span>
        <span className="text-[11px] opacity-80">{start.format("MMM")}</span>
      </div>
      <div className="min-w-0">
        <p className="text-emphasis text-base font-semibold">{start.format("dddd, MMMM D")}</p>
        <p className="text-default mt-0.5 text-sm tabular-nums">
          {start.format(timeFormat)} to {end.format(timeFormat)}
        </p>
        <p className="text-subtle text-sm">{rbpZoneName(timezone)}</p>
      </div>
    </div>
    {showVideoLine && (
      <p className="text-subtle mt-4 flex items-start gap-2 text-sm">
        <Icon name="video" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Video call. The link is in your confirmation email.</span>
      </p>
    )}
    {children}
  </section>
);
