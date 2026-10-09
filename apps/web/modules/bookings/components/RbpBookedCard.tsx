import dayjs from "@calcom/dayjs";
import classNames from "@calcom/ui/classNames";
import { Icon } from "@calcom/ui/components/icon";
import Link from "next/link";
import type { ReactNode } from "react";

import { CalendarServiceLogo } from "./calendar-logos";
import { RbpAppointmentSheet } from "./RbpAppointmentSheet";

type CalendarLink = { label: string; href: string; download?: string };

/**
 * rbp: the lead's own view of their booking, in place of Cal's success page
 * (which named the advisor's email, "Cal Video", "Intro Call between X and Y",
 * and ran a "Create your own booking link with Cal.diy" ad). One card for every
 * state a lead reaches from the embed or the confirmation email:
 *
 *   booked      just booked: is it booked, when, what happens next
 *   moved       the new booking after a reschedule
 *   cancelling  the cancel step; Cal's own cancel form goes in `children`
 *
 * No reschedule or cancel links on the booked page (Grey, 2026-10-05: they
 * invite cold feet). The confirmation email still carries them.
 *   cancelled   after cancelling
 */
export type RbpBookingState = "booked" | "moved" | "cancelling" | "cancelled";

const COPY: Record<RbpBookingState, { title: string; sheet: string }> = {
  booked: { title: "You're booked", sheet: "Your appointment" },
  moved: { title: "Your appointment is moved", sheet: "Your new time" },
  cancelling: { title: "Cancel this appointment?", sheet: "The appointment" },
  cancelled: { title: "Your appointment is cancelled", sheet: "Cancelled" },
};

export const RbpBookedCard = ({
  state,
  startTime,
  endTime,
  timezone,
  email,
  calendarLinks = [],
  children,
}: {
  state: RbpBookingState;
  startTime: string | Date;
  endTime: string | Date;
  timezone: string;
  email?: string;
  calendarLinks?: CalendarLink[];
  children?: ReactNode;
}) => {
  const start = dayjs.utc(startTime).tz(timezone);
  const end = dayjs.utc(endTime).tz(timezone);
  const live = state === "booked" || state === "moved";
  const copy = COPY[state];
  return (
    <div className="mx-auto w-full max-w-xl px-1 py-6 text-center sm:py-10">
      {state !== "cancelling" && (
        // The one authored moment: the mark settles in, then draws itself.
        <div
          aria-hidden="true"
          className={classNames(
            "mx-auto flex h-16 w-16 items-center justify-center rounded-full ring-1 motion-safe:animate-[rbp-pop_420ms_cubic-bezier(0.16,1,0.3,1)_both]",
            live
              ? "bg-[color-mix(in_srgb,var(--cal-brand)_16%,transparent)] ring-[color-mix(in_srgb,var(--cal-brand)_35%,transparent)] shadow-[0_10px_28px_-12px_color-mix(in_srgb,var(--cal-brand)_70%,transparent)]"
              : "bg-muted ring-black/5 dark:ring-white/10"
          )}>
          <svg
            viewBox="0 0 24 24"
            className={classNames("h-7 w-7", live ? "text-[var(--cal-brand)]" : "text-subtle")}
            fill="none">
            <path
              d={live ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"}
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="[stroke-dasharray:1] motion-safe:animate-[rbp-draw_520ms_cubic-bezier(0.16,1,0.3,1)_180ms_both]"
            />
          </svg>
        </div>
      )}
      <h2
        className={classNames(
          "text-emphasis text-[26px] font-semibold leading-tight tracking-[-0.01em]",
          state !== "cancelling" && "mt-5"
        )}
        id="modal-headline"
        data-testid={state === "cancelled" ? "cancelled-headline" : undefined}>
        {copy.title}
      </h2>
      <p className="text-subtle mx-auto mt-2 max-w-sm text-balance text-[15px] leading-snug">
        {live &&
          (email ? (
            <>
              We sent the details and your video link to{" "}
              <span className="text-emphasis font-medium">{email}</span>.
            </>
          ) : (
            "We sent the details and your video link by email."
          ))}
        {state === "cancelling" && "Your specialist is told right away. You can book a new time later."}
        {state === "cancelled" && "We let your specialist know. You can book a new time whenever you're ready."}
      </p>

      <div className={classNames("mt-7", state === "cancelled" && "opacity-60")}>
        <RbpAppointmentSheet
          start={start}
          end={end}
          timezone={timezone}
          timeFormat="h:mma"
          heading={copy.sheet}
          showVideoLine={state !== "cancelled"}>
          <p className="text-subtle mt-2 flex items-start gap-2 text-sm">
            <Icon name="user" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>With a certified Blueprint specialist</span>
          </p>
        </RbpAppointmentSheet>
      </div>

      {children && <div className="mt-6 text-left">{children}</div>}

      {live && calendarLinks.length > 0 && (
        <div className="mt-7 text-left">
          <p className="text-emphasis mb-3 text-sm font-semibold">Add it to your calendar</p>
          <div className="grid grid-cols-2 gap-2">
            {calendarLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                target={link.download ? undefined : "_blank"}
                download={link.download}
                className="bg-default text-emphasis border-subtle hover:border-brand-default flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0)_75%)] px-2 text-sm font-medium shadow-[0_1px_1px_rgba(60,45,20,0.06),0_6px_12px_-8px_rgba(60,45,20,0.30)] transition-[transform,border-color] duration-150 hover:-translate-y-px active:scale-[0.97] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_1px_1px_rgba(0,0,0,0.4),0_8px_14px_-8px_rgba(0,0,0,0.65)]">
                <CalendarServiceLogo label={link.label} />
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
