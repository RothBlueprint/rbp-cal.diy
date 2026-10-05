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

  const data = useMemo(() => rbpWithinLeadHours(schedule?.data, timezone), [schedule?.data, timezone]);

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
