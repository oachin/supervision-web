import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SystemHealthService } from './system-health.service';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';

@Controller('system')
@SkipThrottle()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPERATOR', 'VIEWER')
export class SystemController {
  constructor(private health: SystemHealthService) {}

  @Get('health')
  getHealth() {
    return this.health.getHealth();
  }
}
