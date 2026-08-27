import { ApiProperty } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { IsBoolean, IsEnum, IsString, ValidateNested, IsArray } from "class-validator";

import { SUCCESS_STATUS, ERROR_STATUS } from "@calcom/platform-constants";
import { WebhookTriggerEvents } from "@calcom/platform-libraries";

export class WebhookOutputDto {
  // Webhook.id is a String column (we store a UUID), not an autoincrement int —
  // the previous @IsInt()/number here only ever mistyped the generated docs.
  @IsString()
  @Expose()
  readonly id!: string;

  @IsString()
  @Expose()
  @ApiProperty({
    description:
      "The template of the payload that will be sent to the subscriberUrl, check cal.com/docs/core-features/webhooks for more information",
    example: JSON.stringify({
      content: "A new event has been scheduled",
      type: "{{type}}",
      name: "{{title}}",
      organizer: "{{organizer.name}}",
      booker: "{{attendees.0.name}}",
    }),
  })
  readonly payloadTemplate!: string;

  @IsArray()
  @IsEnum(WebhookTriggerEvents, { each: true })
  @Expose()
  @ApiProperty({ isArray: true, enum: WebhookTriggerEvents })
  readonly triggers!: WebhookTriggerEvents[];

  @IsString()
  @Expose()
  readonly subscriberUrl!: string;

  @IsBoolean()
  @Expose()
  readonly active!: boolean;

  @IsString()
  @Expose()
  readonly secret?: string;
}

export class DeleteManyWebhooksOutputResponseDto {
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  @IsEnum([SUCCESS_STATUS, ERROR_STATUS])
  @Expose()
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  @Expose()
  @ValidateNested()
  @Type(() => WebhookOutputDto)
  data!: string;
}
