import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { AgentAuth, Public } from '../common/decorators';
import { AgentKeyGuard } from '../auth/guards';
import { AgentService } from './agent.service';
import { AgentMetricsDto } from '../common/dto';
import { Server } from '@prisma/client';

interface AgentRequest extends Request {
  server: Server;
}

@Controller('agent')
@Public()
@AgentAuth()
@UseGuards(AgentKeyGuard)
export class AgentController {
  constructor(private agent: AgentService) {}

  @Post('metrics')
  pushMetrics(@Req() req: AgentRequest, @Body() dto: AgentMetricsDto) {
    return this.agent.recordMetrics(req.server, dto);
  }

  @Post('heartbeat')
  heartbeat(@Req() req: AgentRequest) {
    return this.agent.heartbeat(req.server);
  }
}
