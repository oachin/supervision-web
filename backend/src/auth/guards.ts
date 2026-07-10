import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, IS_AGENT_KEY } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isAgent = this.reflector.getAllAndOverride<boolean>(IS_AGENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isAgent) return true;

    return super.canActivate(context);
  }

  handleRequest<T>(err: Error | null, user: T): T {
    if (err || !user) {
      throw err || new UnauthorizedException('Non authentifié');
    }
    return user;
  }
}

@Injectable()
export class AgentKeyGuard {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const agentKey = request.headers['x-agent-key'] as string;

    if (!agentKey) {
      throw new UnauthorizedException('Clé agent manquante');
    }

    const hashed = this.crypto.hashAgentKey(agentKey);
    const server = await this.prisma.server.findFirst({
      where: { agentKey: hashed },
    });

    if (!server) {
      throw new UnauthorizedException('Clé agent invalide');
    }

    request.server = server;
    return true;
  }
}
