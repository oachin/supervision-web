import { Module, forwardRef } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentInstallController } from './agent-install.controller';
import { AgentService } from './agent.service';
import { AgentInstallService } from './agent-install.service';
import { ServersModule } from '../servers/servers.module';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';
import { CyberModule } from '../cyber/cyber.module';

@Module({
  imports: [forwardRef(() => ServersModule), AlertsModule, AuthModule, CyberModule],
  controllers: [AgentController, AgentInstallController],
  providers: [AgentService, AgentInstallService],
  exports: [AgentService, AgentInstallService],
})
export class AgentModule {}
