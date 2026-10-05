/**
 * rbp: "Eastern Time" for America/New_York; the zone id itself if Intl cannot
 * name it. Shared by the slot header and the Set appointment bar so both say
 * the same thing. Leads book in their state's zone, which rbp passes as cal.tz.
 */
export function rbpZoneName(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longGeneric" }).formatToParts(
      new Date()
    );
    return parts.find((part) => part.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}
