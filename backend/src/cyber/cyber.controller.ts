import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { CyberService } from './cyber.service';

@Controller('cyber')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CyberController {
  constructor(private cyber: CyberService) {}

  @Get('overview')
  @RequirePermission('cybersecurity', 'view')
  overview() {
    return this.cyber.overview();
  }

  @Get('targets')
  @RequirePermission('cybersecurity', 'view')
  targets() {
    return this.cyber.listTargets();
  }

  @Patch('targets/supervision/:websiteId')
  @RequirePermission('cybersecurity', 'modify')
  setWebsite(
    @Param('websiteId') websiteId: string,
    @Body('enabled') enabled: boolean,
  ) {
    return this.cyber.setWebsiteScan(websiteId, !!enabled);
  }

  @Post('targets/external')
  @RequirePermission('cybersecurity', 'modify')
  addExternal(@Body() body: { name: string; url: string; notes?: string }) {
    return this.cyber.addExternal(body);
  }

  @Patch('targets/external/:id')
  @RequirePermission('cybersecurity', 'modify')
  updateExternal(
    @Param('id') id: string,
    @Body() body: { name?: string; enabled?: boolean; notes?: string | null },
  ) {
    return this.cyber.updateExternal(id, body);
  }

  @Delete('targets/external/:id')
  @RequirePermission('cybersecurity', 'delete')
  removeExternal(@Param('id') id: string) {
    return this.cyber.removeExternal(id);
  }

  @Post('scan')
  @RequirePermission('cybersecurity', 'modify')
  startScan(@Body() body: { deep?: boolean; authorized?: boolean }) {
    return this.cyber.startScan(body ?? {});
  }

  @Get('scan/status')
  @RequirePermission('cybersecurity', 'view')
  scanStatus() {
    return this.cyber.getScanStatus();
  }

  @Get('sites')
  @RequirePermission('cybersecurity', 'view')
  siteResult(@Query('url') url: string) {
    return this.cyber.getSiteResult(url);
  }
}
