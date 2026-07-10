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
import { WebsitesService } from './websites.service';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateWebsiteDto, UpdateWebsiteDto } from '../common/dto';

@Controller('websites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebsitesController {
  constructor(private websites: WebsitesService) {}

  @Get()
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  findAll() {
    return this.websites.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  findOne(@Param('id') id: string) {
    return this.websites.findOne(id);
  }

  @Get(':id/checks')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  getChecks(@Param('id') id: string, @Query('hours') hours?: string) {
    return this.websites.getChecks(id, hours ? parseInt(hours, 10) : 24);
  }

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  create(@Body() dto: CreateWebsiteDto, @CurrentUser('id') userId: string) {
    return this.websites.create(dto, userId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWebsiteDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.websites.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'OPERATOR')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.websites.remove(id, userId);
  }
}
