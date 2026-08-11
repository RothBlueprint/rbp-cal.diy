import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  MinLength,
} from "class-validator";

export class ProvisionUserInput {
  @ApiProperty({ example: "agent@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "America/New_York",
    description: "Required so the user's default availability schedule is created in the right timezone.",
  })
  @IsTimeZone()
  timeZone!: string;

  @ApiPropertyOptional({ example: "Jane Agent" })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: "Derived from the email local part when omitted." })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: "Password for web-app login. Omit for SSO-only users." })
  @IsString()
  @MinLength(12)
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({
    type: [Number],
    description:
      "Teams the user joins as an accepted MEMBER (required before they can be an event-type host).",
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @IsOptional()
  teamIds?: number[];
}
