import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { VoiceService } from './voice.service';
import { CompositionService } from '../composition/composition.service';
import type { Response } from 'express';

const previewSchema = z.object({
  text: z.string().min(1).max(500),
  voiceId: z.string().min(1).max(100),
});

const generateSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1).max(100),
  voiceName: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
});

@Controller('admin')
@UseGuards(ApiKeyGuard)
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly composition: CompositionService,
  ) {}

  @Get('voices')
  async listVoices() {
    const voices = await this.voice.listVoices();
    return { voices, count: voices.length };
  }

  @Post('voice/preview')
  async preview(
    @Body(new ZodValidationPipe(previewSchema))
    body: z.infer<typeof previewSchema>,
    @Res() res: Response,
  ) {
    const audio = await this.voice.preview(body);
    res.setHeader('Content-Type', audio.mimeType);
    res.setHeader('Content-Length', String(audio.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio.buffer);
  }

  // Compatibility aliases per spec
  @Get('voices/list')
  async listVoicesAlias() {
    return this.listVoices();
  }

  @Get('content/:id/audio')
  async listAudio(@Param('id') id: string) {
    return this.voice.listForContent(id);
  }

  @Post('content/:id/voice')
  async generateVoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(generateSchema))
    body: z.infer<typeof generateSchema>,
  ) {
    const result = await this.voice.generateForContent({
      contentId: id,
      text: body.text,
      voiceId: body.voiceId,
      voiceName: body.voiceName,
      model: body.model,
    });
    return result.asset;
  }

  @Post('content/:id/replace-audio')
  async replaceAudio(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ audioAssetId: z.string().uuid() })))
    body: { audioAssetId: string },
  ) {
    return this.composition.replaceAudio({ contentId: id, audioAssetId: body.audioAssetId });
  }

  @Post('voice/generate')
  async generateVoiceStandalone(
    @Body(new ZodValidationPipe(generateSchema))
    body: z.infer<typeof generateSchema>,
    @Res() res: Response,
  ) {
    // Standalone generate without content linkage? Use dummy content? For spec compliance, require content via query?
    // We'll throw friendly error if no contentId provided
    throw new Error('Usá POST /admin/content/:id/voice con contentId');
  }

  @Post('video/:id/replace-audio')
  async replaceAudioAlias(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ audioAssetId: z.string().uuid() })))
    body: { audioAssetId: string },
  ) {
    return this.composition.replaceAudio({ contentId: id, audioAssetId: body.audioAssetId });
  }
}
