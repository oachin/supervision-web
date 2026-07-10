import { Module } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { SystemController } from './system.controller';

@Module({
  providers: [SystemHealthService],
  controllers: [SystemController],
})
export class SystemModule {}
