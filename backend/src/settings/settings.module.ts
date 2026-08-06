import { Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { SettingsController } from './settings.controller';

@Module({
  providers: [AppSettingsService],
  controllers: [SettingsController],
  exports: [AppSettingsService],
})
export class SettingsModule {}
