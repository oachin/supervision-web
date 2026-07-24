import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ServersService } from './servers.service';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateServerDto, UpdateServerDto } from '../common/dto';

@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServersController {
  constructor(private servers: ServersService) {}

  @Get()
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  findAll() {
    return this.servers.findAll();
  }

  @Get('proxmox/vms')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getAllProxmoxVms() {
    return this.servers.getAllProxmoxVms();
  }

  @Get('proxmox/vms/:vmId')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getProxmoxVmById(@Param('vmId') vmId: string) {
    return this.servers.getProxmoxVmById(vmId);
  }

  @Get(':id/proxmox/vms')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getProxmoxVms(@Param('id') id: string) {
    return this.servers.getProxmoxVms(id);
  }

  @Get(':id/proxmox/vms/:vmid/metrics')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getProxmoxVmMetrics(
    @Param('id') id: string,
    @Param('vmid') vmid: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.servers.getProxmoxVmMetrics(
      id,
      parseInt(vmid, 10),
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get(':id/proxmox/backups')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getProxmoxBackups(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.servers.getProxmoxBackups(id, limit ? parseInt(limit, 10) : 50);
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  findOne(@Param('id') id: string) {
    return this.servers.findOne(id);
  }

  @Get(':id/metrics')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getMetrics(@Param('id') id: string, @Query('hours') hours?: string) {
    return this.servers.getMetrics(id, hours ? parseInt(hours, 10) : 24);
  }

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  create(@Body() dto: CreateServerDto, @CurrentUser('id') userId: string) {
    return this.servers.create(dto, userId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateServerDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.servers.update(id, dto, userId);
  }

  @Post(':id/regenerate-key')
  @Roles('ADMIN', 'OPERATOR')
  regenerateKey(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.servers.regenerateKey(id, userId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.servers.remove(id, userId);
  }
}
