import { Module, forwardRef } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServersController } from './servers.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AlertsModule } from '../alerts/alerts.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [AuditModule, AuthModule, AlertsModule, forwardRef(() => AgentModule)],
  providers: [ServersService],
  controllers: [ServersController],
  exports: [ServersService],
})
export class ServersModule {}
