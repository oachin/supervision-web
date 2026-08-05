import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateUserDto, UpdateUserDto } from '../common/dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @RequirePermission('users', 'view')
  findAll() {
    return this.users.findAll();
  }

  @Post()
  @RequirePermission('users', 'modify')
  create(@Body() dto: CreateUserDto, @CurrentUser('id') adminId: string) {
    return this.users.create(dto, adminId);
  }

  @Patch(':id')
  @RequirePermission('users', 'modify')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.users.update(id, dto, adminId);
  }

  @Post(':id/resend-invite')
  @RequirePermission('users', 'modify')
  resendInvite(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.users.resendInvite(id, adminId);
  }

  @Post(':id/reset-2fa')
  @RequirePermission('users', 'modify')
  resetTotp(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.users.resetTotp(id, adminId);
  }

  @Delete(':id')
  @RequirePermission('users', 'delete')
  remove(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.users.remove(id, adminId);
  }
}
