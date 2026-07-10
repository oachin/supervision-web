import { Controller, Get, Patch, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AlertStatus } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('alerts')
@SkipThrottle()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPERATOR', 'VIEWER')
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get('popup')
  getPendingPopup() {
    return this.alerts.getPendingPopup();
  }

  @Get('summary')
  getSummary() {
    return this.alerts.getSummary();
  }

  @Get('events')
  getEvents(@Query('limit') limit?: string) {
    return this.alerts.getEvents(limit ? parseInt(limit, 10) : 200);
  }

  @Get()
  findAll(@Query('status') status?: AlertStatus) {
    return this.alerts.findAll(status);
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.alerts.acknowledge(id, userId);
  }

  @Post(':id/close')
  @Roles('ADMIN', 'OPERATOR')
  close(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { origin: string; resolutionMethod: string },
  ) {
    return this.alerts.close(id, userId, body.origin, body.resolutionMethod);
  }
}
