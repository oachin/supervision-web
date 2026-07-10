import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';

@Controller('dashboard')
@SkipThrottle()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPERATOR', 'VIEWER')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get()
  getOverview() {
    return this.dashboard.getOverview();
  }
}
