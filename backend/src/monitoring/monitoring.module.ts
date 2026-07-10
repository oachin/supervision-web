import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { WebsiteProbeService } from './website-probe.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  providers: [MonitoringService, WebsiteProbeService],
})
export class MonitoringModule {}
