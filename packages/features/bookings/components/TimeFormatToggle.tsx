/**
 * rbp: the 12h/24h switch is removed — it renders nothing.
 *
 * Every lead and every agent on this instance is in the US, so the control only
 * ever offered a way to make the booker harder to read. The booker is pinned to
 * 12-hour in timePreferences.ts; this file stays (rather than the call sites
 * losing it) so an upstream merge that touches the toggle still lands here and
 * nowhere else.
 */
export const TimeFormatToggle = (_props: { customClassName?: string }) => null;
