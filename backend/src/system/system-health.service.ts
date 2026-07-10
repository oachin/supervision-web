import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as http from 'http';
import { PrismaService } from '../prisma/prisma.service';

export type ComponentStatus = 'up' | 'down';

export interface SystemComponent {
  id: string;
  name: string;
  container: string;
  status: ComponentStatus;
  message: string;
  latencyMs?: number;
}

export interface SystemHealth {
  status: 'operational' | 'degraded';
  label: string;
  checkedAt: string;
  components: SystemComponent[];
  faults: string[];
}

@Injectable()
export class SystemHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(SystemHealthService.name);
  private redis: Redis | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  async getHealth(): Promise<SystemHealth> {
    const components = await Promise.all([
      this.checkApi(),
      this.checkPostgres(),
      this.checkRedis(),
      this.checkFrontend(),
    ]);

    const faults = components
      .filter((c) => c.status === 'down')
      .map((c) => `${c.name} : ${c.message}`);

    const operational = faults.length === 0;

    return {
      status: operational ? 'operational' : 'degraded',
      label: operational ? 'Système opérationnel' : 'Système en défaut',
      checkedAt: new Date().toISOString(),
      components,
      faults,
    };
  }

  private checkApi(): SystemComponent {
    return {
      id: 'api',
      name: 'API Backend',
      container: 'supervision-backend',
      status: 'up',
      message: 'Service actif',
    };
  }

  private async checkPostgres(): Promise<SystemComponent> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        id: 'postgres',
        name: 'Base de données',
        container: 'supervision-postgres',
        status: 'up',
        message: 'PostgreSQL connecté',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.warn(`PostgreSQL health check failed: ${err}`);
      return {
        id: 'postgres',
        name: 'Base de données',
        container: 'supervision-postgres',
        status: 'down',
        message: 'PostgreSQL inaccessible',
      };
    }
  }

  private async checkRedis(): Promise<SystemComponent> {
    const start = Date.now();
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      return {
        id: 'redis',
        name: 'Cache Redis',
        container: 'supervision-redis',
        status: 'down',
        message: 'REDIS_URL non configurée',
      };
    }

    try {
      if (!this.redis) {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        });
      }
      if (this.redis.status !== 'ready') {
        await this.redis.connect();
      }
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Réponse inattendue: ${pong}`);
      }
      return {
        id: 'redis',
        name: 'Cache Redis',
        container: 'supervision-redis',
        status: 'up',
        message: 'Redis connecté',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${err}`);
      this.redis?.disconnect();
      this.redis = null;
      return {
        id: 'redis',
        name: 'Cache Redis',
        container: 'supervision-redis',
        status: 'down',
        message: 'Redis inaccessible',
      };
    }
  }

  private checkFrontend(): Promise<SystemComponent> {
    const url = this.config.get<string>('FRONTEND_INTERNAL_URL', 'http://frontend:3000');
    const start = Date.now();

    return new Promise((resolve) => {
      const req = http.get(url, { timeout: 5000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve({
            id: 'frontend',
            name: 'Interface Web',
            container: 'supervision-frontend',
            status: 'up',
            message: `HTTP ${res.statusCode}`,
            latencyMs: Date.now() - start,
          });
        } else {
          resolve({
            id: 'frontend',
            name: 'Interface Web',
            container: 'supervision-frontend',
            status: 'down',
            message: `HTTP ${res.statusCode ?? 'erreur'}`,
          });
        }
      });

      req.on('error', () => {
        resolve({
          id: 'frontend',
          name: 'Interface Web',
          container: 'supervision-frontend',
          status: 'down',
          message: 'Conteneur frontend injoignable',
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          id: 'frontend',
          name: 'Interface Web',
          container: 'supervision-frontend',
          status: 'down',
          message: 'Timeout (5s)',
        });
      });
    });
  }
}
