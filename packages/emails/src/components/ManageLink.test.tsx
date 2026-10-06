import { getRichDescription } from "@calcom/lib/CalEventParser";
import { buildCalendarEvent, buildPerson } from "@calcom/lib/test/builder";
import { describe, expect, it } from "vitest";

import renderEmail from "../renderEmail";

// rbp: the lead's confirmation carries no reschedule/cancel links (they invite
// cold feet); the host's keeps them.
describe("rbp: manage links", () => {
  const organizer = buildPerson({ email: "host@example.com", name: "Host" });
  const lead = buildPerson({ email: "lead@example.com", name: "Lead" });
  const calEvent = buildCalendarEvent({
    organizer,
    attendees: [lead],
    bookerUrl: "https://calendar.example.com",
    uid: "abc123",
    team: { id: 1, name: "Pool", members: [] },
  });

  it("the lead's confirmation email has no reschedule or cancel link", async () => {
    const html = await renderEmail("AttendeeScheduledEmail", { calEvent, attendee: lead });
    expect(html).not.toMatch(/\/reschedule\//);
    expect(html).not.toMatch(/cancel=true/);
    expect(html).not.toContain("need_to_make_a_change");
  });

  it("the host's email keeps them", async () => {
    const html = await renderEmail("OrganizerScheduledEmail", { calEvent, attendee: organizer });
    expect(html).toContain("need_to_make_a_change");
  });

  it("the invite and plain-text description carry no manage link", () => {
    expect(getRichDescription(calEvent, organizer.language.translate)).not.toContain(
      "need_to_reschedule_or_cancel"
    );
  });
});
