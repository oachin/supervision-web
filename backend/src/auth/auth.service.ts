import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto, VerifyTotpDto, EnableTotpDto, ChangePasswordDto } from '../common/dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });

    if (!user || !user.isActive) {
      await this.audit.log(null, 'LOGIN_FAILED', 'auth', { email: dto.email, reason: 'user_not_found' }, ip, userAgent);
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Compte temporairement verrouillé. Réessayez plus tard.');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      const failedCount = user.failedLoginCount + 1;
      const lockedUntil = failedCount >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCK_DURATION_MS)
        : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failedCount, lockedUntil },
      });

      await this.audit.log(user.id, 'LOGIN_FAILED', 'auth', { reason: 'bad_password' }, ip, userAgent);
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.totpEnabled) {
      const tempToken = this.jwt.sign(
        { sub: user.id, type: 'totp_pending' },
        { secret: this.config.getOrThrow('JWT_SECRET'), expiresIn: '5m' },
      );
      return { requiresTotp: true, tempToken };
    }

    return this.issueTokens(user.id, user.email, user.role, user.name, ip, userAgent);
  }

  async verifyTotp(dto: VerifyTotpDto, ip: string, userAgent: string) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(dto.tempToken, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Session expirée, reconnectez-vous');
    }

    if (payload.type !== 'totp_pending') {
      throw new UnauthorizedException('Token invalide');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.totpSecret) {
      throw new UnauthorizedException('Utilisateur invalide');
    }

    const isValidTotp = authenticator.verify({ token: dto.code, secret: user.totpSecret });
    const isBackupCode = user.totpBackupCodes.includes(dto.code);

    if (!isValidTotp && !isBackupCode) {
      await this.audit.log(user.id, 'TOTP_FAILED', 'auth', {}, ip, userAgent);
      throw new UnauthorizedException('Code 2FA invalide');
    }

    if (isBackupCode) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { totpBackupCodes: user.totpBackupCodes.filter((c) => c !== dto.code) },
      });
    }

    return this.issueTokens(user.id, user.email, user.role, user.name, ip, userAgent);
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: string,
    name: string,
    ip: string,
    userAgent: string,
  ) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, role, type: 'access' },
      { secret: this.config.getOrThrow('JWT_SECRET'), expiresIn: '15m' },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId, expiresAt, ipAddress: ip, userAgent },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.audit.log(userId, 'LOGIN_SUCCESS', 'auth', {}, ip, userAgent);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: { id: userId, email, role, name },
    };
  }

  async refresh(refreshToken: string, ip: string, userAgent: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revoked || stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Refresh token invalide');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    return this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role,
      stored.user.name,
      ip,
      userAgent,
    );
  }

  async logout(refreshToken: string, userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken, userId },
      data: { revoked: true },
    });
    return { success: true };
  }

  async setupTotp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    if (user.totpEnabled) throw new BadRequestException('2FA déjà activée');

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'Havet Supervision', secret);
    const qrCode = await QRCode.toDataURL(otpauth);

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    return { secret, qrCode };
  }

  async enableTotp(userId: string, dto: EnableTotpDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) throw new BadRequestException('Configurez d\'abord la 2FA');

    const valid = authenticator.verify({ token: dto.code, secret: user.totpSecret });
    if (!valid) throw new BadRequestException('Code invalide');

    const backupCodes = Array.from({ length: 8 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, totpBackupCodes: backupCodes },
    });

    await this.audit.log(userId, 'TOTP_ENABLED', 'auth', {});

    return { backupCodes };
  }

  async disableTotp(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Mot de passe incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
    });

    await this.audit.log(userId, 'TOTP_DISABLED', 'auth', {});
    return { success: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) throw new UnauthorizedException('Mot de passe actuel incorrect');

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { revoked: true },
    });

    await this.audit.log(userId, 'PASSWORD_CHANGED', 'auth', {});
    return { success: true };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        totpEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    return user;
  }
}
