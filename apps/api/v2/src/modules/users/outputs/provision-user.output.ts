import { ERROR_STATUS, SUCCESS_STATUS } from "@calcom/platform-constants";
import { ApiProperty } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { IsArray, IsEmail, IsInt, IsString, ValidateNested } from "class-validator";

export class ProvisionedUserDto {
  @ApiProperty()
  @Expose()
  @IsInt()
  id!: number;

  @ApiProperty()
  @Expose()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @Expose()
  @IsString()
  username!: string;

  @ApiProperty()
  @Expose()
  @IsString()
  timeZone!: string;

  @ApiProperty({ description: "Id of the default availability schedule created for the user." })
  @Expose()
  @IsInt()
  defaultScheduleId!: number;

  @ApiProperty({ type: [Number] })
  @Expose()
  @IsArray()
  teamIds!: number[];
}

export class ProvisionUserOutput {
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  @ApiProperty({ type: ProvisionedUserDto })
  @ValidateNested()
  @Type(() => ProvisionedUserDto)
  data!: ProvisionedUserDto;
}
