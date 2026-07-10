import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { AlertsModule } from '../alerts/alerts.module';
import { ServersModule } from '../servers/servers.module';

@Module({
  imports: [AlertsModule, ServersModule],
  providers: [MonitoringService],
})
export class MonitoringModule {}
