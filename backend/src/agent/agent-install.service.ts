import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
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

  buildInstallUrl(profile: 'linux' | 'plesk' | 'proxmox', plainKey: string): string {
    const origin = this.config.get<string>('CORS_ORIGIN', 'http://localhost:4000').replace(/\/$/, '');
    return `${origin}/api/agent/install/${profile}?key=${encodeURIComponent(plainKey)}`;
  }

  buildWgetCommand(profile: 'linux' | 'plesk' | 'proxmox', plainKey: string): string {
    return `wget -qO- "${this.buildInstallUrl(profile, plainKey)}" | sudo bash`;
  }

  profileToSlug(profile: AgentProfile): 'linux' | 'plesk' | 'proxmox' {
    if (profile === 'PLESK') return 'plesk';
    if (profile === 'PROXMOX') return 'proxmox';
    return 'linux';
  }

  async getInstallScript(
    profile: 'linux' | 'plesk' | 'proxmox',
    plainKey: string,
    publicOrigin?: string,
  ): Promise<string> {
    const server = await this.findServerByPlainKey(plainKey);
    const expected: AgentProfile =
      profile === 'plesk' ? 'PLESK' : profile === 'proxmox' ? 'PROXMOX' : 'LINUX';
    if (server.profile !== expected) {
      throw new NotFoundException('Profil agent incompatible');
    }

    const origin = (publicOrigin || this.config.get<string>('CORS_ORIGIN', 'http://localhost:4000')).replace(
      /\/$/,
      '',
    );
    const apiUrl = `${origin}/api`;
    const installUrl = `${apiUrl}/agent/install/${profile}?key=${encodeURIComponent(plainKey)}`;
    const binary = await this.assertAgentBinaryAvailable(plainKey);
    const template = await readFile(this.templatePath, 'utf8');

    return template
      .replace(/__API_URL__/g, apiUrl)
      .replace(/__AGENT_KEY__/g, plainKey)
      .replace(/__PROFILE__/g, profile)
      .replace(/__INSTALL_URL__/g, installUrl)
      .replace(/__EXPECTED_SHA256__/g, binary.sha256);
  }

  getAgentBinaryPath(): string {
    return this.binaryPath;
  }

  async assertAgentBinaryAvailable(plainKey: string): Promise<{ path: string; size: number; sha256: string }> {
    await this.findServerByPlainKey(plainKey);
    if (!existsSync(this.binaryPath)) {
      throw new NotFoundException('Binaire agent non disponible');
    }
    const buf = await readFile(this.binaryPath);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const size = statSync(this.binaryPath).size;
    return { path: this.binaryPath, size, sha256 };
  }

  private async findServerByPlainKey(plainKey: string) {
    const hashed = this.crypto.hashAgentKey(plainKey);
    const server = await this.prisma.server.findFirst({ where: { agentKey: hashed } });
    if (!server) throw new NotFoundException('Clé agent invalide');
    return server;
  }
}
