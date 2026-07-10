import { IsEmail, IsString, MinLength, IsOptional, Length, IsIn, IsArray, ValidateNested, IsNumber, IsInt, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class VerifyTotpDto {
  @IsString()
  tempToken!: string;

  @IsString()
  @Length(6, 8)
  code!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export class EnableTotpDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  newPassword!: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsOptional()
  @IsString()
  role?: 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  role?: 'ADMIN' | 'OPERATOR' | 'VIEWER';

  @IsOptional()
  isActive?: boolean;
}

export class CreateServerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsIn(['LINUX', 'PLESK'])
  profile?: 'LINUX' | 'PLESK';

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  hasPlesk?: boolean;

  @IsOptional()
  @IsString()
  pleskUrl?: string;

  @IsOptional()
  @IsString()
  pleskApiKey?: string;

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  hasPlesk?: boolean;

  @IsOptional()
  @IsString()
  pleskUrl?: string;

  @IsOptional()
  @IsString()
  pleskApiKey?: string;

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateWebsiteDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  serverId?: string;

  @IsOptional()
  checkInterval?: number;

  @IsOptional()
  expectedStatus?: number;

  @IsOptional()
  @IsString()
  expectedKeyword?: string;

  @IsOptional()
  sslEnabled?: boolean;

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateWebsiteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  serverId?: string;

  @IsOptional()
  checkInterval?: number;

  @IsOptional()
  expectedStatus?: number;

  @IsOptional()
  @IsString()
  expectedKeyword?: string;

  @IsOptional()
  sslEnabled?: boolean;

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];
}

export class AgentPleskWebsiteDto {
  @IsString()
  name!: string;

  @IsString()
  url!: string;
}

export class AgentMetricsDto {
  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  profile?: string;

  @IsNumber()
  cpuPercent!: number;

  @IsNumber()
  memoryPercent!: number;

  @IsNumber()
  memoryUsedMb!: number;

  @IsNumber()
  memoryTotalMb!: number;

  @IsNumber()
  diskPercent!: number;

  @IsNumber()
  diskUsedGb!: number;

  @IsNumber()
  diskTotalGb!: number;

  @IsNumber()
  loadAvg1!: number;

  @IsNumber()
  loadAvg5!: number;

  @IsNumber()
  loadAvg15!: number;

  @IsInt()
  uptimeSeconds!: number;

  @IsOptional()
  @IsInt()
  pleskDomains?: number;

  @IsOptional()
  @IsObject()
  pleskServices?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentPleskWebsiteDto)
  pleskWebsites?: AgentPleskWebsiteDto[];
}
