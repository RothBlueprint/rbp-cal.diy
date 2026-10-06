import dayjs from "@calcom/dayjs";
import { describe, expect, it } from "vitest";

import { rbpLastBookableDay, rbpWindowDays, rbpWithinWindow } from "./useEvent";

// rbp: the booking window rbp passes as `rbp.days` (set in the Django admin).
describe("rbp: booking window", () => {
  // Tuesday 2026-10-06, 10:00 in Phoenix.
  const now = dayjs.utc("2026-10-06T17:00:00Z");
  const tz = "America/Phoenix";

  it("counts business days after today, skipping the weekend", () => {
    // Wed 7, Thu 8, Fri 9, Mon 12, Tue 13, Wed 14, Thu 15.
    expect(rbpLastBookableDay(7, tz, now)).toBe("2026-10-15");
    expect(rbpLastBookableDay(1, tz, now)).toBe("2026-10-07");
  });

  it("starts from today in the lead's zone, not UTC", () => {
    // 03:00 UTC on Wed 7 is still Tue 6 in Phoenix.
    const lateEvening = dayjs.utc("2026-10-07T03:00:00Z");
    expect(rbpLastBookableDay(1, tz, lateEvening)).toBe("2026-10-07");
  });

  it("drops the days past the window and keeps today", () => {
    const data = {
      slots: {
        "2026-10-06": [{ time: "a" }],
        "2026-10-15": [{ time: "b" }],
        "2026-10-16": [{ time: "c" }],
        "2026-11-02": [{ time: "d" }],
      },
    };
    const kept = rbpWithinWindow(data, 7, tz, now);
    expect(Object.keys(kept.slots)).toEqual(["2026-10-06", "2026-10-15"]);
  });

  it("leaves a later month empty instead of falling back", () => {
    const data = { slots: { "2026-11-02": [{ time: "d" }] } };
    expect(rbpWithinWindow(data, 7, tz, now).slots).toEqual({});
  });

  it("does nothing without a valid day count", () => {
    const data = { slots: { "2026-11-02": [{ time: "d" }] } };
    expect(rbpWithinWindow(data, null, tz, now)).toBe(data);
    for (const raw of [null, "", "0", "61", "7.5", "-3", "seven"]) {
      expect(rbpWindowDays(raw)).toBeNull();
    }
    expect(rbpWindowDays("7")).toBe(7);
    expect(rbpWindowDays("60")).toBe(60);
  });
});
