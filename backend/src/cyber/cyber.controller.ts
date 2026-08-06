import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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

  @Get('automation')
  @RequirePermission('cybersecurity', 'view')
  getAutomation() {
    return this.cyber.getAutomation();
  }

  @Patch('automation')
  @RequirePermission('cybersecurity', 'modify')
  updateAutomation(
    @Body()
    body: {
      enabled?: boolean;
      intervalMinutes?: number;
      dailyTimes?: string[];
      autoExcludeUrls?: string[];
      deep?: boolean;
      timezone?: string;
    },
  ) {
    return this.cyber.updateAutomation(body ?? {});
  }

  @Get('sites')
  @RequirePermission('cybersecurity', 'view')
  siteResult(@Query('url') url: string, @Query('run_id') runId?: string) {
    if (runId != null && runId !== '') {
      const n = Number(runId);
      return this.cyber.getSiteResultAtRun(url, n);
    }
    return this.cyber.getSiteResult(url);
  }

  @Get('trend')
  @RequirePermission('cybersecurity', 'view')
  trend(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 30;
    return this.cyber.getTrend(Number.isFinite(n) ? n : 30);
  }

  @Get('history')
  @RequirePermission('cybersecurity', 'view')
  history(@Query('url') url: string, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 30;
    return this.cyber.getHistory(url, Number.isFinite(n) ? n : 30);
  }

  @Get('report/global')
  @RequirePermission('cybersecurity', 'view')
  async reportGlobal(
    @Query('fmt') fmt: string,
    @Query('lang') lang: string,
    @Res() res: Response,
  ) {
    const file = await this.cyber.getGlobalReport(
      fmt === 'pdf' ? 'pdf' : 'html',
      lang || 'fr',
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/"/g, '')}"`,
    );
    res.send(file.buffer);
  }

  @Get('report/site')
  @RequirePermission('cybersecurity', 'view')
  async reportSite(
    @Query('url') url: string,
    @Query('fmt') fmt: string,
    @Query('lang') lang: string,
    @Res() res: Response,
  ) {
    const file = await this.cyber.getSiteReport(
      url,
      fmt === 'pdf' ? 'pdf' : 'html',
      lang || 'fr',
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/"/g, '')}"`,
    );
    res.send(file.buffer);
  }
}
