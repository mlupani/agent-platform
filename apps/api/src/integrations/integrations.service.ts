import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  async list(businessId: string) {
    const items = await this.prisma.integration.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(({ secretsEnc, ...item }) => ({
      ...item,
      hasSecrets: Boolean(secretsEnc),
    }));
  }

  async create(data: {
    businessId: string;
    type: string;
    name: string;
    config: object;
    secrets?: Record<string, unknown>;
  }) {
    const created = await this.prisma.integration.create({
      data: {
        businessId: data.businessId,
        type: data.type,
        name: data.name,
        config: data.config,
        secretsEnc: data.secrets
          ? this.secrets.encrypt(JSON.stringify(data.secrets))
          : undefined,
      },
    });
    return { ...created, secretsEnc: undefined, hasSecrets: Boolean(data.secrets) };
  }
}
