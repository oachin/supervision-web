import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ServersModule } from './servers/servers.module';
import { WebsitesModule } from './websites/websites.module';
import { AlertsModule } from './alerts/alerts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AgentModule } from './agent/agent.module';
import { AuditModule } from './audit/audit.module';
import { SeedModule } from './seed/seed.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 30 },
      { name: 'medium', ttl: 60000, limit: 500 },
      { name: 'auth', ttl: 900000, limit: 20 },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    ServersModule,
    WebsitesModule,
    AlertsModule,
    DashboardModule,
    AgentModule,
    AuditModule,
    SeedModule,
    MonitoringModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
