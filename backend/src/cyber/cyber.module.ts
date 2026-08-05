import { Module } from '@nestjs/common';
import { CyberController } from './cyber.controller';
import { CyberService } from './cyber.service';
import { WebsecClient } from './websec-client';

@Module({
  controllers: [CyberController],
  providers: [CyberService, WebsecClient],
  exports: [CyberService],
})
export class CyberModule {}
