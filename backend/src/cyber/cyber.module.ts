import { Module } from '@nestjs/common';
import { CyberController } from './cyber.controller';
import { CyberService } from './cyber.service';
import { WebsecClient } from './websec-client';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [CyberController],
  providers: [CyberService, WebsecClient],
  exports: [CyberService],
})
export class CyberModule {}


