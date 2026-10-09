/**
 * Booking questions for RothBlueprint intro event types (pool and personal).
 *
 * Django reads the phone from `responses.attendeePhoneNumber` (webhook),
 * `bookingFieldsResponses.attendeePhoneNumber` (REST), then
 * `attendees[0].phoneNumber`. The slug has to be exactly `attendeePhoneNumber`.
 *
 * `smsConsent` is optional and unchecked. Django does not read it.
 */

export const INTRO_SMS_CONSENT_NAME = "smsConsent";

export const INTRO_SMS_CONSENT_LABEL =
  "Yes, I would like to receive automated text messages from RothBlueprint to remind me about my booked consultation";

const defaultSource = {
  label: "Default",
  id: "default",
  type: "default",
} as const;

export const introAttendeePhoneField = {
  defaultLabel: "phone_number",
  type: "phone" as const,
  name: "attendeePhoneNumber",
  required: true,
  hidden: false,
  editable: "system-but-optional" as const,
  sources: [defaultSource],
};

export const introSmsConsentField = {
  name: INTRO_SMS_CONSENT_NAME,
  type: "boolean" as const,
  label: INTRO_SMS_CONSENT_LABEL,
  required: false,
  hidden: false,
  editable: "user" as const,
  sources: [
    {
      id: "user" as const,
      type: "user" as const,
      label: "User" as const,
      fieldRequired: false,
    },
  ],
};

/**
 * Canonical intro form. Location sits after the consent checkbox so a hidden
 * single location does not land between the phone field and the checkbox.
 * Guests stay hidden — the public form is name, email, phone, consent, notes.
 */
export function introBookingFields() {
  return [
    {
      type: "name" as const,
      name: "name",
      editable: "system" as const,
      defaultLabel: "your_name",
      required: true,
      sources: [defaultSource],
    },
    {
      type: "email" as const,
      name: "email",
      editable: "system-but-optional" as const,
      defaultLabel: "email_address",
      required: true,
      sources: [defaultSource],
    },
    introAttendeePhoneField,
    introSmsConsentField,
    {
      defaultLabel: "location",
      type: "radioInput" as const,
      name: "location",
      editable: "system" as const,
      hideWhenJustOneOption: true,
      required: false,
      getOptionsAt: "locations",
      optionsInputs: {
        attendeeInPerson: { type: "address" as const, required: true, placeholder: "" },
        somewhereElse: { type: "text" as const, required: true, placeholder: "" },
        phone: { type: "phone" as const, required: true, placeholder: "" },
      },
      sources: [defaultSource],
    },
    {
      defaultLabel: "additional_notes",
      type: "textarea" as const,
      name: "notes",
      editable: "system-but-optional" as const,
      required: false,
      defaultPlaceholder: "share_additional_notes",
      sources: [defaultSource],
    },
    {
      defaultLabel: "what_is_this_meeting_about",
      type: "text" as const,
      name: "title",
      editable: "system-but-optional" as const,
      required: true,
      hidden: true,
      defaultPlaceholder: "",
      sources: [defaultSource],
    },
    {
      defaultLabel: "additional_guests",
      type: "multiemail" as const,
      editable: "system-but-optional" as const,
      name: "guests",
      defaultPlaceholder: "email",
      required: false,
      hidden: true,
      sources: [defaultSource],
    },
  ];
}
