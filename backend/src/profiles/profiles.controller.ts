import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequireAnyPermission, RequirePermission } from '../common/permissions.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { PermissionsMap } from '../permissions/permissions';

@Controller('profiles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProfilesController {
  constructor(private profiles: ProfilesService) {}

  @Get()
  @RequireAnyPermission(
    { resource: 'profiles', action: 'view' },
    { resource: 'users', action: 'view' },
  )
  findAll() {
    return this.profiles.findAll();
  }

  @Get(':id')
  @RequirePermission('profiles', 'view')
  findOne(@Param('id') id: string) {
    return this.profiles.findOne(id);
  }

  @Post()
  @RequirePermission('profiles', 'modify')
  create(
    @Body() body: { name: string; description?: string; permissions: PermissionsMap },
    @CurrentUser('id') adminId: string,
  ) {
    return this.profiles.create(body, adminId);
  }

  @Patch(':id')
  @RequirePermission('profiles', 'modify')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; permissions?: PermissionsMap },
    @CurrentUser('id') adminId: string,
  ) {
    return this.profiles.update(id, body, adminId);
  }

  @Delete(':id')
  @RequirePermission('profiles', 'delete')
  remove(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.profiles.remove(id, adminId);
  }
}
