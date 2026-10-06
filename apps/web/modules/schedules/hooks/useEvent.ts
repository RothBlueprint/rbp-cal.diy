import { useMemo } from "react";
import { shallow } from "zustand/shallow";

import dayjs from "@calcom/dayjs";

import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { useSchedule } from "@calcom/web/modules/schedules/hooks/useSchedule";
import { useCompatSearchParams } from "@calcom/lib/hooks/useCompatSearchParams";
import { trpc } from "@calcom/trpc/react";

import { useBookerTime } from "@calcom/features/bookings/Booker/hooks/useBookerTime";

export type useEventReturnType = ReturnType<typeof useEvent>;
export type useScheduleForEventReturnType = ReturnType<typeof useScheduleForEvent>;

/**
 * rbp: leads only see start times from 8:00am up to 8:00pm in the zone the
 * booker shows (their state's zone, which rbp passes as cal.tz). A pool
 * advisor in another zone can otherwise surface a 4:00am start. This runs on
 * the schedule data itself, so the day strip, the slot list and the
 * availability checks all agree, and a day left with no times drops out.
 * If no day keeps a time, the times are shown unfiltered: an odd hour beats
 * an empty calendar.
 */
const RBP_FIRST_HOUR = 8;
const RBP_LAST_HOUR = 20;

export function rbpWithinLeadHours<D>(data: D, timezone: string | null | undefined): D {
  const slots = (data as { slots?: Record<string, { time: string }[]> } | null | undefined)?.slots;
  if (!slots || !timezone) return data;
  const kept: Record<string, { time: string }[]> = {};
  for (const [date, daySlots] of Object.entries(slots)) {
    const inHours = daySlots.filter((slot) => {
      const hour = dayjs.utc(slot.time).tz(timezone).hour();
      return hour >= RBP_FIRST_HOUR && hour < RBP_LAST_HOUR;
    });
    if (inHours.length) kept[date] = inHours;
  }
  if (!Object.keys(kept).length) return data;
  return { ...data, slots: kept };
}

/**
 * rbp: the booking window. rbp passes `rbp.days` on the booking link (set in
 * the Django admin): leads only see days up to that many business days after
 * today, in the zone the booker shows. Weekends do not count. No param, or a
 * value that is not a whole number from 1 to 60, means no window. Unlike the
 * lead-hours rule there is no fallback: a later month is meant to be empty.
 */
const RBP_MAX_WINDOW_DAYS = 60;

export function rbpWindowDays(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const days = Number(raw);
  return days >= 1 && days <= RBP_MAX_WINDOW_DAYS ? days : null;
}

export function rbpLastBookableDay(days: number, timezone: string | null | undefined, now = dayjs()): string {
  let day = (timezone ? now.tz(timezone) : now).startOf("day");
  let counted = 0;
  while (counted < days) {
    day = day.add(1, "day");
    const weekday = day.day();
    if (weekday !== 0 && weekday !== 6) counted++;
  }
  return day.format("YYYY-MM-DD");
}

export function rbpWithinWindow<D>(
  data: D,
  days: number | null,
  timezone: string | null | undefined,
  now = dayjs()
): D {
  const slots = (data as { slots?: Record<string, unknown[]> } | null | undefined)?.slots;
  if (!slots || !days) return data;
  const last = rbpLastBookableDay(days, timezone, now);
  const kept: Record<string, unknown[]> = {};
  for (const [date, daySlots] of Object.entries(slots)) {
    if (date <= last) kept[date] = daySlots;
  }
  return { ...data, slots: kept };
}

/**
 * Wrapper hook around the trpc query that fetches
 * the event currently viewed in the booker. It will get
 * the current event slug and username from the booker store.
 *
 * Using this hook means you only need to use one hook, instead
 * of combining multiple conditional hooks.
 */
export const useEvent = (props?: { fromRedirectOfNonOrgLink?: boolean; disabled?: boolean }) => {
  const [username, eventSlug, isTeamEvent, org] = useBookerStoreContext(
    (state) => [state.username, state.eventSlug, state.isTeamEvent, state.org],
    shallow
  );

  const event = trpc.viewer.public.event.useQuery(
    {
      username: username ?? "",
      eventSlug: eventSlug ?? "",
      isTeamEvent,
      org: org ?? null,
      fromRedirectOfNonOrgLink: props?.fromRedirectOfNonOrgLink,
    },
    {
      refetchOnWindowFocus: false,
      enabled: !props?.disabled && Boolean(username) && Boolean(eventSlug),
    }
  );

  return {
    data: event?.data,
    isSuccess: event?.isSuccess,
    isError: event?.isError,
    isPending: event?.isPending,
  };
};

/**
 * Gets schedule for the current event and current month.
 * Gets all values right away and not the store because it increases network timing, only for the first render.
 * We can read from the store if we want to get the latest values.
 *
 * Using this hook means you only need to use one hook, instead
 * of combining multiple conditional hooks.
 *
 * The prefetchNextMonth argument can be used to prefetch two months at once,
 * useful when the user is viewing dates near the end of the month,
 * this way the multi day view will show data of both months.
 */
export const useScheduleForEvent = ({
  username,
  eventSlug,
  eventId,
  month,
  duration,
  dayCount,
  selectedDate,
  orgSlug,
  teamMemberEmail,
  isTeamEvent,
  useApiV2 = true,
  bookerLayout,
}: {
  username?: string | null;
  eventSlug?: string | null;
  eventId?: number | null;
  month?: string | null;
  duration?: number | null;
  dayCount?: number | null;
  selectedDate?: string | null;
  orgSlug?: string;
  teamMemberEmail?: string | null;
  fromRedirectOfNonOrgLink?: boolean;
  isTeamEvent?: boolean;
  useApiV2?: boolean;
  /**
   * Required when prefetching is needed
   */
  bookerLayout?: {
    layout: string;
    extraDays: number;
    columnViewExtraDays: { current: number };
  };
}) => {
  const { timezone } = useBookerTime();
  const [usernameFromStore, eventSlugFromStore, monthFromStore, durationFromStore] = useBookerStoreContext(
    (state) => [state.username, state.eventSlug, state.month, state.selectedDuration],
    shallow
  );

  const searchParams = useCompatSearchParams();
  const rescheduleUid = searchParams?.get("rescheduleUid");

  const schedule = useSchedule({
    username: usernameFromStore ?? username,
    eventSlug: eventSlugFromStore ?? eventSlug,
    eventId,
    timezone,
    selectedDate,
    dayCount,
    rescheduleUid,
    month: monthFromStore ?? month,
    duration: durationFromStore ?? duration,
    isTeamEvent,
    orgSlug,
    teamMemberEmail,
    useApiV2: useApiV2,
    bookerLayout,
  });

  const windowDays = rbpWindowDays(searchParams?.get("rbp.days"));
  const data = useMemo(
    () => rbpWithinWindow(rbpWithinLeadHours(schedule?.data, timezone), windowDays, timezone),
    [schedule?.data, timezone, windowDays]
  );

  return {
    data,
    isPending: schedule?.isPending,
    isError: schedule?.isError,
    isSuccess: schedule?.isSuccess,
    isLoading: schedule?.isLoading,
    invalidate: schedule?.invalidate,
    dataUpdatedAt: schedule?.dataUpdatedAt,
  };
};
