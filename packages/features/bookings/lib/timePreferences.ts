import { create } from "zustand";

import { TimeFormat, setIs24hClockInLocalStorage } from "@calcom/lib/timeFormat";
import { CURRENT_TIMEZONE } from "@calcom/lib/timezoneConstants";
import { localStorage } from "@calcom/lib/webstorage";

type TimePreferencesStore = {
  timeFormat: TimeFormat.TWELVE_HOUR | TimeFormat.TWENTY_FOUR_HOUR;
  setTimeFormat: (format: TimeFormat.TWELVE_HOUR | TimeFormat.TWENTY_FOUR_HOUR) => void;
  timezone: string;
  setTimezone: (timeZone: string) => void;
};

const timezoneLocalStorageKey = "timeOption.preferredTimeZone";

/**
 * This hook is NOT inside the user feature, since
 * these settings only apply to the booker component. They will not reflect
 * any changes made in the user settings.
 */
export const timePreferencesStore = create<TimePreferencesStore>((set) => ({
  // rbp: the booker is 12-hour, always. Upstream seeds this from
  // detectBrowserTimeFormat, which reads the browser locale and a localStorage
  // key an earlier visit wrote. Every lead and every agent here is in the US, so
  // the only thing that ever produced a 24-hour booker was a stray locale — and
  // with the 12h/24h switch gone (TimeFormatToggle) there is no way back from
  // one. setTimeFormat still works for anything that sets it deliberately.
  timeFormat: TimeFormat.TWELVE_HOUR,
  setTimeFormat: (format: TimeFormat.TWELVE_HOUR | TimeFormat.TWENTY_FOUR_HOUR) => {
    setIs24hClockInLocalStorage(format === TimeFormat.TWENTY_FOUR_HOUR);
    set({ timeFormat: format });
  },
  timezone: localStorage.getItem(timezoneLocalStorageKey) || CURRENT_TIMEZONE,
  setTimezone: (timezone: string) => {
    localStorage.setItem(timezoneLocalStorageKey, timezone);
    set({ timezone });
  },
}));

export const useTimePreferences = timePreferencesStore;
