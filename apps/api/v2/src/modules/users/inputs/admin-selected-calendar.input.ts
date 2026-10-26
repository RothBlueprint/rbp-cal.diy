import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString } from "class-validator";

/**
 * Body of POST /v2/users/{userId}/selected-calendars: turn on conflict checking for one
 * calendar inside a connected account.
 *
 * No `integration`, unlike upstream's SelectedCalendarsInputDto. It is derived from the
 * credential, so a caller cannot file a Google calendar id under office365 and get a row
 * that matches no credential at free/busy time.
 */
export class AdminSelectedCalendarInput {
  @IsInt()
  @ApiProperty({ description: "The calendar connection (Credential) the calendar belongs to.", example: 39 })
  credentialId!: number;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: "The provider's calendar id, as listed under that connection by GET /v2/users/{userId}/calendars.",
    example: "c_0123abcd@group.calendar.google.com",
  })
  externalId!: string;
}
