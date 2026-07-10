import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { ReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { AgentProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';

@Injectable()
export class AgentInstallService {
  private readonly templatePath = join(__dirname, 'templates', 'install.sh');
  private readonly binaryPath = join(process.cwd(), 'agent-bin', 'supervision-agent');

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private config: ConfigService,
  ) {}

  getPublicApiUrl(): string {
    const origin = this.config.get<string>('CORS_ORIGIN', 'http://localhost:4000');
    return `${origin.replace(/\/$/, '')}/api`;
  }

  buildInstallUrl(profile: 'linux' | 'plesk', plainKey: string): string {
    const origin = this.config.get<string>('CORS_ORIGIN', 'http://localhost:4000').replace(/\/$/, '');
    return `${origin}/api/agent/install/${profile}?key=${encodeURIComponent(plainKey)}`;
  }

  buildWgetCommand(profile: 'linux' | 'plesk', plainKey: string): string {
    return `wget -qO- "${this.buildInstallUrl(profile, plainKey)}" | sudo bash`;
  }

  profileToSlug(profile: AgentProfile): 'linux' | 'plesk' {
    return profile === 'PLESK' ? 'plesk' : 'linux';
  }

  async getInstallScript(profile: 'linux' | 'plesk', plainKey: string): Promise<string> {
    const server = await this.findServerByPlainKey(plainKey);
    const expected: AgentProfile = profile === 'plesk' ? 'PLESK' : 'LINUX';
    if (server.profile !== expected) {
      throw new NotFoundException('Profil agent incompatible');
    }

    const apiUrl = this.getPublicApiUrl();
    const installUrl = this.buildInstallUrl(profile, plainKey);
    const template = await readFile(this.templatePath, 'utf8');

    return template
      .replace(/__API_URL__/g, apiUrl)
      .replace(/__AGENT_KEY__/g, plainKey)
      .replace(/__PROFILE__/g, profile)
      .replace(/__INSTALL_URL__/g, installUrl);
  }

  async getAgentBinary(plainKey: string): Promise<ReadStream> {
    await this.findServerByPlainKey(plainKey);
    if (!existsSync(this.binaryPath)) {
      throw new NotFoundException('Binaire agent non disponible');
    }
    return createReadStream(this.binaryPath);
  }

  private async findServerByPlainKey(plainKey: string) {
    const hashed = this.crypto.hashAgentKey(plainKey);
    const server = await this.prisma.server.findFirst({ where: { agentKey: hashed } });
    if (!server) throw new NotFoundException('Clé agent invalide');
    return server;
  }
}
