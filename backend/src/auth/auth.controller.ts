import { Controller, Post, Body, Get, UseGuards, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators';
import { JwtAuthGuard } from './guards';
import { CurrentUser, ClientInfo } from '../common/current-user.decorator';
import {
  LoginDto,
  VerifyTotpDto,
  RefreshTokenDto,
  EnableTotpDto,
  ChangePasswordDto,
} from '../common/dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 900000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @ClientInfo() client: { ip: string; userAgent: string }) {
    return this.auth.login(dto, client.ip, client.userAgent);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 900000 } })
  @Post('verify-totp')
  @HttpCode(200)
  verifyTotp(@Body() dto: VerifyTotpDto, @ClientInfo() client: { ip: string; userAgent: string }) {
    return this.auth.verifyTotp(dto, client.ip, client.userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @ClientInfo() client: { ip: string; userAgent: string }) {
    return this.auth.refresh(dto.refreshToken, client.ip, client.userAgent);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto, @CurrentUser('id') userId: string) {
    return this.auth.logout(dto.refreshToken, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.auth.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/setup')
  setupTotp(@CurrentUser('id') userId: string) {
    return this.auth.setupTotp(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/enable')
  enableTotp(@CurrentUser('id') userId: string, @Body() dto: EnableTotpDto) {
    return this.auth.enableTotp(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/disable')
  disableTotp(@CurrentUser('id') userId: string, @Body('password') password: string) {
    return this.auth.disableTotp(userId, password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(userId, dto);
  }
}
