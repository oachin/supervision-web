import { Controller, Get, Param, Query, Res, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { AgentInstallService } from './agent-install.service';

@Controller('agent')
@Public()
@SkipThrottle()
export class AgentInstallController {
  constructor(private install: AgentInstallService) {}

  @Get('install/linux')
  installLinux(@Query('key') key: string, @Res() res: Response) {
    return this.serveInstall('linux', key, res);
  }

  @Get('install/plesk')
  installPlesk(@Query('key') key: string, @Res() res: Response) {
    return this.serveInstall('plesk', key, res);
  }

  @Get('download/linux-amd64')
  async downloadBinary(@Query('key') key: string, @Res() res: Response) {
    if (!key?.startsWith('sv_')) {
      throw new BadRequestException('Clé agent invalide');
    }
    const stream = await this.install.getAgentBinary(key);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="supervision-agent"');
    stream.pipe(res);
  }

  private async serveInstall(profile: 'linux' | 'plesk', key: string, res: Response) {
    if (!key?.startsWith('sv_')) {
      throw new BadRequestException('Clé agent invalide');
    }
    const script = await this.install.getInstallScript(profile, key);
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.send(script);
  }
}
