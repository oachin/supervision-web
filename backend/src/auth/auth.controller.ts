import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
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
  CompleteInvitePasswordDto,
  InviteTotpDto,
} from '../common/dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Get('invite/:token')
  getInvite(@Param('token') token: string) {
    return this.auth.getInviteInfo(token);
  }

  @Public()
  @Post('invite/password')
  @HttpCode(200)
  invitePassword(@Body() dto: CompleteInvitePasswordDto) {
    return this.auth.completeInvitePassword(dto.token, dto.password);
  }

  @Public()
  @Post('invite/resume')
  @HttpCode(200)
  inviteResume(@Body('token') token: string) {
    if (!token) throw new BadRequestException('Token requis');
    return this.auth.resumeInvite(token);
  }

  @Public()
  @Post('invite/totp/setup')
  @HttpCode(200)
  inviteTotpSetup(@Body() dto: InviteTotpDto) {
    return this.auth.setupInviteTotp(dto.inviteToken);
  }

  @Public()
  @Post('invite/totp/enable')
  @HttpCode(200)
  inviteTotpEnable(
    @Body() dto: InviteTotpDto,
    @ClientInfo() client: { ip: string; userAgent: string },
  ) {
    if (!dto.code) throw new BadRequestException('Code 2FA requis');
    return this.auth.enableInviteTotp(dto.inviteToken, dto.code, client.ip, client.userAgent);
  }

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
