import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class CostControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async assertWithinLimits(businessId: string, model: string): Promise<void> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new HttpException('Business not found', HttpStatus.NOT_FOUND);
    }

    if (
      business.allowedModels.length &&
      !business.allowedModels.includes(model) &&
      !model.startsWith('gemini-')
    ) {
      throw new HttpException(
        `Model ${model} is not allowed for this business`,
        HttpStatus.FORBIDDEN,
      );
    }

    const day = new Date().toISOString().slice(0, 10);
    const requestsKey = `usage:${businessId}:${day}:requests`;
    const tokensKey = `usage:${businessId}:${day}:tokens`;

    const requests = Number((await this.redis.get(requestsKey)) ?? '0');
    const tokens = Number((await this.redis.get(tokensKey)) ?? '0');

    if (requests >= business.dailyRequestLimit) {
      throw new HttpException(
        'Daily request limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (tokens >= business.dailyTokenLimit) {
      throw new HttpException(
        'Daily token limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async incrementUsage(
    businessId: string,
    tokens: number,
  ): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const requestsKey = `usage:${businessId}:${day}:requests`;
    const tokensKey = `usage:${businessId}:${day}:tokens`;
    const requests = await this.redis.incr(requestsKey);
    if (requests === 1) await this.redis.expire(requestsKey, 60 * 60 * 48);
    await this.redis.incrby(tokensKey, tokens);
    if (tokens > 0) await this.redis.expire(tokensKey, 60 * 60 * 48);
  }
}
