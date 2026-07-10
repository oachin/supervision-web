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
