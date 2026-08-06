import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { AppSettingsService } from './app-settings.service';

class UpdateAppSettingsDto {
  @IsString()
  @MinLength(1)
  timezone!: string;
}

@Controller('settings')
export class SettingsController {
  constructor(private settings: AppSettingsService) {}

  /** Any authenticated user — used to format timestamps everywhere. */
  @Get('app')
  @UseGuards(JwtAuthGuard)
  getApp() {
    return this.settings.get();
  }

  @Put('app')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings', 'modify')
  updateApp(@Body() dto: UpdateAppSettingsDto) {
    return this.settings.update(dto);
  }
}
