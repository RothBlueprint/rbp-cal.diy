import { ERROR_STATUS, SUCCESS_STATUS } from "@calcom/platform-constants";
import { ApiProperty } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { IsInt, IsString, IsUrl, ValidateNested } from "class-validator";

export class LoginTokenDto {
  @ApiProperty({ description: "Single-use token; consume at the url below." })
  @Expose()
  @IsString()
  token!: string;

  @ApiProperty({
    description:
      "Full SSO url. Redirect the user's browser here to sign them in; append &next=/path to land them somewhere specific (defaults to the calendar dashboard).",
  })
  @Expose()
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiProperty({ description: "Seconds until the token expires." })
  @Expose()
  @IsInt()
  expiresInSeconds!: number;
}

export class LoginTokenOutput {
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  @ApiProperty({ type: LoginTokenDto })
  @ValidateNested()
  @Type(() => LoginTokenDto)
  data!: LoginTokenDto;
}
