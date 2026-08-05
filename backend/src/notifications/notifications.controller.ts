import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { NotificationsService } from './notifications.service';
import {
  CreateNotificationRuleDto,
  TestSmtpDto,
  UpdateNotificationRuleDto,
  UpsertSmtpSettingsDto,
} from './notifications.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get('smtp')
  @RequirePermission('notifications', 'view')
  getSmtp() {
    return this.notifications.getSmtpSettings();
  }

  @Put('smtp')
  @RequirePermission('notifications', 'modify')
  upsertSmtp(@Body() dto: UpsertSmtpSettingsDto) {
    return this.notifications.upsertSmtpSettings(dto);
  }

  @Post('smtp/test')
  @RequirePermission('notifications', 'modify')
  testSmtp(@Body() dto: TestSmtpDto) {
    return this.notifications.testSmtp(dto);
  }

  @Get('rules')
  @RequirePermission('notifications', 'view')
  listRules() {
    return this.notifications.listRules();
  }

  @Post('rules')
  @RequirePermission('notifications', 'modify')
  createRule(@Body() dto: CreateNotificationRuleDto) {
    return this.notifications.createRule(dto);
  }

  @Patch('rules/:id')
  @RequirePermission('notifications', 'modify')
  updateRule(@Param('id') id: string, @Body() dto: UpdateNotificationRuleDto) {
    return this.notifications.updateRule(id, dto);
  }

  @Delete('rules/:id')
  @RequirePermission('notifications', 'delete')
  deleteRule(@Param('id') id: string) {
    return this.notifications.deleteRule(id);
  }
}
