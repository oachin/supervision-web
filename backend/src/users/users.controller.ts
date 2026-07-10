import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateUserDto, UpdateUserDto } from '../common/dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser('id') adminId: string) {
    return this.users.create(dto, adminId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.users.update(id, dto, adminId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.users.remove(id, adminId);
  }
}
