import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateUserDto, UpdateUserDto } from '../common/dto';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  private fullName(firstName: string, lastName: string) {
    return `${firstName.trim()} ${lastName.trim()}`.trim();
  }

  private hashInviteToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private inviteUrl(token: string) {
    const origin = this.config.get<string>('CORS_ORIGIN', 'http://localhost:3000').replace(/\/$/, '');
    return `${origin}/invite/${token}`;
  }

  private async resolveProfile(profileId?: string, role?: string) {
    if (profileId) {
      const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
      if (!profile) throw new BadRequestException('Profil introuvable');
      return profile;
    }

    const slug =
      role === 'ADMIN' ? 'administrateur' : role === 'OPERATOR' ? 'operateur' : 'lecteur';
    const profile = await this.prisma.profile.findUnique({ where: { slug } });
    if (!profile) throw new BadRequestException('Profil système introuvable');
    return profile;
  }

  private async issueInvite(userId: string, email: string, firstName: string) {
    const token = randomBytes(32).toString('hex');
    const inviteTokenHash = this.hashInviteToken(token);
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const inviteSentAt = new Date();
    const url = this.inviteUrl(token);

    await this.prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash, inviteExpiresAt, inviteSentAt },
    });

    await this.notifications.sendMail({
      to: email,
      subject: '[Havet Supervision] Activez votre compte',
      text: [
        `Bonjour ${firstName},`,
        '',
        'Un compte a été créé pour vous sur le Centre de Supervision & Cybersécurité Havet Digital.',
        '',
        'Cliquez sur le lien suivant pour définir votre mot de passe et activer la double authentification (2FA) :',
        url,
        '',
        'Ce lien expire dans 72 heures.',
        '',
        'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.',
      ].join('\n'),
      html: `
        <p>Bonjour <strong>${firstName}</strong>,</p>
        <p>Un compte a été créé pour vous sur le <strong>Centre de Supervision &amp; Cybersécurité</strong> Havet Digital.</p>
        <p>Cliquez sur le bouton ci-dessous pour définir votre mot de passe et activer la double authentification (2FA)&nbsp;:</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Activer mon compte
          </a>
        </p>
        <p style="color:#666;font-size:13px">Lien valable 72 heures.<br/>${url}</p>
      `,
    });

    return { inviteUrl: url, inviteExpiresAt, inviteSentAt };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        totpEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        profileId: true,
        inviteExpiresAt: true,
        inviteSentAt: true,
        inviteTokenHash: true,
        passwordHash: true,
        profile: {
          select: { id: true, name: true, slug: true, baseRole: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map(({ passwordHash, inviteTokenHash, ...u }) => ({
      ...u,
      hasPassword: !!passwordHash,
      invitePending: !passwordHash || !!inviteTokenHash,
    }));
  }

  async create(dto: CreateUserDto, adminId: string) {
    const email = dto.email.toLowerCase().trim();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    if (!firstName || !lastName) {
      throw new BadRequestException('Prénom et nom requis');
    }

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email déjà utilisé');

    const profile = await this.resolveProfile(dto.profileId, dto.role);
    const name = this.fullName(firstName, lastName);

    const user = await this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        name,
        role: profile.baseRole,
        profileId: profile.id,
        passwordHash: null,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        role: true,
        profileId: true,
        createdAt: true,
        profile: { select: { id: true, name: true, slug: true } },
      },
    });

    const invite = await this.issueInvite(user.id, email, firstName);
    await this.audit.log(adminId, 'USER_CREATED', 'users', { userId: user.id, invite: true });

    return { ...user, ...invite, invitePending: true };
  }

  async update(id: string, dto: UpdateUserDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    let profileId = user.profileId;
    let role = user.role;
    let firstName = user.firstName;
    let lastName = user.lastName;

    if (dto.firstName !== undefined) firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) lastName = dto.lastName.trim();
    if (!firstName || !lastName) {
      throw new BadRequestException('Prénom et nom requis');
    }

    if (dto.profileId) {
      const profile = await this.resolveProfile(dto.profileId);
      profileId = profile.id;
      role = profile.baseRole;
    } else if (dto.role) {
      const profile = await this.resolveProfile(undefined, dto.role);
      profileId = profile.id;
      role = profile.baseRole;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName,
        lastName,
        name: this.fullName(firstName, lastName),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        profileId,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        profileId: true,
        totpEnabled: true,
        inviteSentAt: true,
        inviteExpiresAt: true,
        profile: { select: { id: true, name: true, slug: true } },
      },
    });

    await this.audit.log(adminId, 'USER_UPDATED', 'users', { userId: id, changes: dto });
    return {
      ...updated,
      invitePending: !!updated.inviteSentAt && !updated.totpEnabled,
    };
  }

  async resendInvite(id: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.totpEnabled && user.passwordHash && !user.inviteTokenHash) {
      throw new BadRequestException('Ce compte est déjà activé');
    }

    const invite = await this.issueInvite(user.id, user.email, user.firstName || user.name);
    await this.audit.log(adminId, 'USER_INVITE_RESENT', 'users', { userId: id });
    return { success: true, ...invite };
  }

  async resetTotp(id: string, adminId: string) {
    if (id === adminId) {
      throw new BadRequestException('Utilisez Mon compte pour gérer votre propre 2FA');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    await this.prisma.user.update({
      where: { id },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpBackupCodes: [],
      },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId: id },
      data: { revoked: true },
    });

    await this.audit.log(adminId, 'USER_TOTP_RESET', 'users', { userId: id });
    return { success: true };
  }

  async remove(id: string, adminId: string) {
    if (id === adminId) throw new ConflictException('Impossible de supprimer votre propre compte');

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    await this.prisma.user.delete({ where: { id } });
    await this.audit.log(adminId, 'USER_DELETED', 'users', { userId: id, email: user.email });
    return { success: true };
  }

}
