import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { KnowledgeService } from './knowledge.service';

const createBaseSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
});

const faqSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000),
  category: z.string().optional(),
  knowledgeBaseId: z.string().uuid().optional(),
});

const updateFaqSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50_000).optional(),
  category: z.string().optional(),
});

@Controller('admin/knowledge')
@UseGuards(ApiKeyGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  workspace() {
    return this.knowledge.getWorkspace();
  }

  @Get('business/:businessId')
  listBases(@Param('businessId') businessId: string) {
    return this.knowledge.listBases(businessId);
  }

  @Post('bases')
  createBase(
    @Body(new ZodValidationPipe(createBaseSchema))
    body: z.infer<typeof createBaseSchema>,
  ) {
    return this.knowledge.createBase(body);
  }

  @Get('bases/:id/documents')
  listDocuments(@Param('id') id: string) {
    return this.knowledge.listDocuments(id);
  }

  @Post('faq')
  createFaq(
    @Body(new ZodValidationPipe(faqSchema)) body: z.infer<typeof faqSchema>,
  ) {
    return this.knowledge.createFaq(body);
  }

  @Get('documents/:id')
  getDocument(@Param('id') id: string) {
    return this.knowledge.getDocument(id);
  }

  @Patch('documents/:id')
  updateFaq(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFaqSchema))
    body: z.infer<typeof updateFaqSchema>,
  ) {
    return this.knowledge.updateFaq(id, body);
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string) {
    return this.knowledge.deleteDocument(id);
  }

  @Post('documents/:id/reindex')
  reindex(@Param('id') id: string) {
    return this.knowledge.reindex(id);
  }

  @Post('bases/:id/documents')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string; category?: string },
  ) {
    const document = await this.knowledge.createDocument({
      knowledgeBaseId: id,
      title: body.title || file.originalname,
      source: file.originalname,
      mimeType: file.mimetype,
      category: body.category || 'general',
    });
    const result = await this.knowledge.ingest(
      document.id,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return {
      document: await this.knowledge.getDocument(document.id),
      ...result,
    };
  }
}
