import { Module } from '@nestjs/common';
import { WebsitesService } from './websites.service';
import { WebsitesController } from './websites.controller';
import { AuditModule } from '../audit/audit.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AuditModule, AlertsModule],
  providers: [WebsitesService],
  controllers: [WebsitesController],
  exports: [WebsitesService],
})
export class WebsitesModule {}
