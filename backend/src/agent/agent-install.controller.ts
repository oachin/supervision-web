import { Controller, Get, Query, Req, Res, BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { readFile } from 'fs/promises';
import { Public } from '../common/decorators';
import { AgentInstallService } from './agent-install.service';

@Controller('agent')
@Public()
@SkipThrottle()
export class AgentInstallController {
  constructor(private install: AgentInstallService) {}

  @Get('install/linux')
  installLinux(@Query('key') key: string, @Req() req: Request, @Res() res: Response) {
    return this.serveInstall('linux', key, req, res);
  }

  @Get('install/plesk')
  installPlesk(@Query('key') key: string, @Req() req: Request, @Res() res: Response) {
    return this.serveInstall('plesk', key, req, res);
  }

  @Get('install/proxmox')
  installProxmox(@Query('key') key: string, @Req() req: Request, @Res() res: Response) {
    return this.serveInstall('proxmox', key, req, res);
  }

  @Get('download/linux-amd64')
  async downloadBinary(@Query('key') key: string, @Res() res: Response) {
    if (!key?.startsWith('sv_')) {
      throw new BadRequestException('Clé agent invalide');
    }
    const meta = await this.install.assertAgentBinaryAvailable(key);
    const buf = await readFile(meta.path);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="supervision-agent"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Agent-Sha256', meta.sha256);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  private async serveInstall(
    profile: 'linux' | 'plesk' | 'proxmox',
    key: string,
    req: Request,
    res: Response,
  ) {
    if (!key?.startsWith('sv_')) {
      throw new BadRequestException('Clé agent invalide');
    }
    // Use the Host actually hit (behind nginx), not CORS_ORIGIN which may point elsewhere.
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.get('host') || 'localhost';
    const publicOrigin = `${proto.split(',')[0].trim()}://${host}`;
    const script = await this.install.getInstallScript(profile, key, publicOrigin);
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  }
}
