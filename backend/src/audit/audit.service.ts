import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(
    userId: string | null,
    action: string,
    resource?: string,
    details?: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        resource,
        details: details as Prisma.InputJsonValue | undefined,
        ipAddress,
        userAgent,
      },
    });
  }

  async findAll(limit = 100) {
    return this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
      },
    });
  }
}
