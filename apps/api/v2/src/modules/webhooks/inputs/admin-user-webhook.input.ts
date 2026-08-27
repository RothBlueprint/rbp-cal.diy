import { WebhookTriggerEvents } from "@calcom/platform-libraries";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString } from "class-validator";

/**
 * Body of POST /v2/users/{userId}/webhooks — the admin-on-behalf-of route that
 * provisions a webhook for one of a user's personal event types.
 *
 * Deliberately NOT `CreateWebhookInputDto`:
 *  - `eventTypeId` is part of the body here (the path param is the user), and the
 *    row written is event-type-scoped, so the field has to be carried and checked.
 *  - the trigger list is named `eventTriggers`, matching the Webhook column and the
 *    delivered payload, rather than the older public alias `triggers`.
 *  - `version` is not accepted. The Webhook.version column defaults to "2021-10-20"
 *    and rbp parses that payload shape (notably `payload.rescheduleUid`); letting a
 *    provisioning caller pick a different one would silently break the receiver.
 */
export class UpsertUserWebhookInputDto {
  @IsInt()
  @ApiProperty({
    description:
      "Event type to scope the webhook to. Must be a PERSONAL event type owned by {userId} — team event types are rejected, because in this fork team-scoped delivery never fires (see UPSTREAM-BUGS.md #1).",
    example: 7,
  })
  eventTypeId!: number;

  @IsString()
  @ApiProperty({ example: "https://rothblueprint.com/leads/cal_webhook" })
  subscriberUrl!: string;

  @IsArray()
  @IsEnum(WebhookTriggerEvents, { each: true })
  @ApiProperty({
    isArray: true,
    enum: WebhookTriggerEvents,
    example: ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "BOOKING_REJECTED"],
  })
  eventTriggers!: WebhookTriggerEvents[];

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      "Shared secret for the X-Cal-Signature-256 HMAC. Omit to leave an existing webhook's secret untouched; on first creation, omitting it means the delivery is unsigned.",
  })
  secret?: string;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description: "Defaults to true, so a re-run reactivates a webhook someone had disabled.",
    default: true,
  })
  active?: boolean;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      "Overrides the delivered body. Leave unset unless you know the receiver wants a custom shape — the default is the versioned payload built by BookingPayloadBuilder. Omit to leave an existing webhook's template untouched.",
  })
  payloadTemplate?: string;
}
