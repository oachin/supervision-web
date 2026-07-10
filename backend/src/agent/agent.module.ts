import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ServersModule } from '../servers/servers.module';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ServersModule, AlertsModule, AuthModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
