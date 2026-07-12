import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertSmtpSettingsDto {
  @IsString()
  @MinLength(1)
  host!: string;

  @IsInt()
  @Min(1)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsEmail()
  fromEmail!: string;

  @IsString()
  @MinLength(1)
  fromName!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class TestSmtpDto {
  @IsEmail()
  to!: string;
}

export class CreateNotificationRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsArray()
  @IsEmail({}, { each: true })
  recipients!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serverIds?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'], { each: true })
  severities?: ('INFO' | 'WARNING' | 'CRITICAL')[];

  @IsOptional()
  @IsBoolean()
  notifyOnCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnOccurrence?: boolean;
}

export class UpdateNotificationRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  recipients?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serverIds?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'], { each: true })
  severities?: ('INFO' | 'WARNING' | 'CRITICAL')[];

  @IsOptional()
  @IsBoolean()
  notifyOnCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnOccurrence?: boolean;
}
