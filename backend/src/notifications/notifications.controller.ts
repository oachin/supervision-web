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
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { NotificationsService } from './notifications.service';
import {
  CreateNotificationRuleDto,
  TestSmtpDto,
  UpdateNotificationRuleDto,
  UpsertSmtpSettingsDto,
} from './notifications.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get('smtp')
  @Roles('ADMIN', 'OPERATOR')
  getSmtp() {
    return this.notifications.getSmtpSettings();
  }

  @Put('smtp')
  @Roles('ADMIN')
  upsertSmtp(@Body() dto: UpsertSmtpSettingsDto) {
    return this.notifications.upsertSmtpSettings(dto);
  }

  @Post('smtp/test')
  @Roles('ADMIN')
  testSmtp(@Body() dto: TestSmtpDto) {
    return this.notifications.testSmtp(dto);
  }

  @Get('rules')
  @Roles('ADMIN', 'OPERATOR')
  listRules() {
    return this.notifications.listRules();
  }

  @Post('rules')
  @Roles('ADMIN')
  createRule(@Body() dto: CreateNotificationRuleDto) {
    return this.notifications.createRule(dto);
  }

  @Patch('rules/:id')
  @Roles('ADMIN')
  updateRule(@Param('id') id: string, @Body() dto: UpdateNotificationRuleDto) {
    return this.notifications.updateRule(id, dto);
  }

  @Delete('rules/:id')
  @Roles('ADMIN')
  deleteRule(@Param('id') id: string) {
    return this.notifications.deleteRule(id);
  }
}
