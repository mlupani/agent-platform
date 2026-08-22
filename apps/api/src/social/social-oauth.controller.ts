import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { SocialPublishingService } from './social-publishing.service';

@Controller('social/oauth')
@SkipThrottle()
export class SocialOAuthController {
  constructor(private readonly social: SocialPublishingService) {}

  @Get('callback')
  async callback(
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const { adminRedirect } = await this.social.handleOAuthCallback(query);
    return res.redirect(adminRedirect);
  }
}
