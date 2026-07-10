import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AlertsModule],
  providers: [MonitoringService],
})
export class MonitoringModule {}
