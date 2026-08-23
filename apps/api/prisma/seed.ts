import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DEFAULT_CONFIGURED_MESSAGES } from '../src/common/constants';
import { industrySeeds, parseIndustry } from './seeds';
import type { IndustrySeed } from './seeds/types';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

const TOOLS = [
  { name: 'getBusinessInformation', risk: 'READ', requireConfirmation: false },
  { name: 'getOpeningHours', risk: 'READ', requireConfirmation: false },
  { name: 'getServices', risk: 'READ', requireConfirmation: false },
  { name: 'checkAvailability', risk: 'READ', requireConfirmation: false },
  { name: 'createAppointment', risk: 'WRITE', requireConfirmation: false },
  { name: 'cancelAppointment', risk: 'WRITE', requireConfirmation: false },
  { name: 'rescheduleAppointment', risk: 'WRITE', requireConfirmation: false },
  { name: 'createLead', risk: 'WRITE', requireConfirmation: false },
  { name: 'requestHumanAssistance', risk: 'WRITE', requireConfirmation: false },
  { name: 'sendEmail', risk: 'WRITE', requireConfirmation: false },
  { name: 'sendWhatsAppMessage', risk: 'WRITE', requireConfirmation: false },
  { name: 'triggerAutomation', risk: 'WRITE', requireConfirmation: false },
];

function legacyOpeningHours(weekly: IndustrySeed['weeklyHours']) {
  const legacyKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return Object.fromEntries(
    weekly.map((day) => {
      const key = legacyKeys[day.dayOfWeek];
      if (day.isClosed || !day.ranges.length) return [key, null];
      return [
        key,
        {
          open: day.ranges[0].start,
          close: day.ranges[day.ranges.length - 1].end,
          ranges: day.ranges,
        },
      ];
    }),
  );
}

async function resetDatabase() {
  await prisma.appointment.deleteMany();
  await prisma.googleCalendarConfig.deleteMany();
  await prisma.whatsAppConfig.deleteMany();
  await prisma.webChatConfig.deleteMany();
  await prisma.toolExecution.deleteMany();
  await prisma.agentExecution.deleteMany();
  await prisma.message.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.documentChunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.agentConfig.deleteMany();
  await prisma.knowledgeBase.deleteMany();
  await prisma.toolConfig.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.automation.deleteMany();
  await prisma.service.deleteMany();
  await prisma.businessHour.deleteMany();
  await prisma.user.deleteMany();
  await prisma.business.deleteMany();
}

async function seedFaqEmbeddings(
  documentId: string,
  chunkIds: string[],
  chunks: string[],
) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      'OPENAI_API_KEY ausente: FAQ seed sin embeddings. Reindexá desde Knowledge.',
    );
    return;
  }

  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model =
      process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
    const response = await client.embeddings.create({
      model,
      input: chunks,
    });
    for (let i = 0; i < chunkIds.length; i += 1) {
      const embedding = response.data[i]?.embedding;
      if (!embedding) continue;
      const literal = `[${embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
        literal,
        chunkIds[i],
      );
    }
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'ready' },
    });
    console.log(`Seed FAQ embeddings OK (${chunkIds.length} chunks)`);
  } catch (error) {
    console.warn(
      'Seed FAQ sin embeddings (OpenAI falló). Reindexá desde el dashboard.',
      error instanceof Error ? error.message : error,
    );
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'failed' },
    });
  }
}

async function seedIndustry(industry: IndustrySeed) {
  await resetDatabase();

  const openingHours = legacyOpeningHours(industry.weeklyHours);
  const business = await prisma.business.create({
    data: {
      name: industry.business.name,
      slug: industry.business.slug,
      description: industry.business.description,
      type: industry.type,
      timezone: industry.business.timezone,
      language: industry.business.language,
      address: industry.business.address,
      phone: industry.business.phone,
      whatsapp: industry.business.whatsapp,
      email: industry.business.email,
      website: industry.business.website,
      instagram: industry.business.instagram,
      additionalInfo: industry.business.additionalInfo,
      openingHours,
      defaultMessages: {
        ...DEFAULT_CONFIGURED_MESSAGES,
        ...industry.business.defaultMessages,
      },
      rules: industry.business.rules,
      allowedModels: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini'],
    },
  });

  await prisma.businessHour.createMany({
    data: industry.weeklyHours.map((day) => ({
      businessId: business.id,
      dayOfWeek: day.dayOfWeek,
      isClosed: day.isClosed,
      ranges: day.ranges,
    })),
  });

  await prisma.service.createMany({
    data: industry.services.map((service) => ({
      businessId: business.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      price: service.price,
      priceDescription: service.priceDescription,
      enabled: service.enabled ?? true,
      requiresAppointment: service.requiresAppointment ?? true,
      sortOrder: service.sortOrder,
    })),
  });

  const knowledgeBase = await prisma.knowledgeBase.create({
    data: {
      businessId: business.id,
      name: industry.knowledgeBase.name,
      description: industry.knowledgeBase.description,
    },
  });

  await prisma.toolConfig.createMany({
    data: TOOLS.map((tool) => ({
      businessId: business.id,
      ...tool,
    })),
  });

  await prisma.agentConfig.create({
    data: {
      businessId: business.id,
      knowledgeBaseId: knowledgeBase.id,
      name: industry.agent.name,
      description: industry.agent.description,
      provider: 'openai',
      model: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4.1-mini',
      tone: industry.agent.tone,
      customInstructions: industry.agent.customInstructions,
      personality: industry.agent.personality,
      systemPrompt: industry.agent.systemPrompt,
      temperature: 0.4,
      maxSteps: 8,
      enabledTools: TOOLS.map((tool) => tool.name),
      enabledChannels: ['WEB', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'PLAYGROUND'],
      memoryStrategy: {
        recentMessages: 12,
        includeSummary: true,
        semanticTopK: 3,
      },
      isDefault: true,
    },
  });

  const document = await prisma.document.create({
    data: {
      knowledgeBaseId: knowledgeBase.id,
      businessId: business.id,
      title: `FAQ ${industry.business.name}`,
      source: `seed-faq-${industry.slug}.md`,
      mimeType: 'text/markdown',
      category: 'faq',
      status: 'pending',
      content: industry.faq,
    },
  });

  const chunks = industry.faq
    .split(/\n(?=##\s+)/)
    .map((part) => part.trim())
    .filter(Boolean);

  const createdChunks = await Promise.all(
    chunks.map((content, index) =>
      prisma.documentChunk.create({
        data: {
          documentId: document.id,
          businessId: business.id,
          content,
          source: `seed-faq-${industry.slug}.md`,
          category: 'faq',
          page: index + 1,
        },
      }),
    ),
  );

  await seedFaqEmbeddings(
    document.id,
    createdChunks.map((chunk) => chunk.id),
    chunks,
  );

  await prisma.automation.create({
    data: {
      businessId: business.id,
      name: industry.automation.name,
      description: industry.automation.description,
      webhookUrl: industry.automation.webhookUrl,
      enabled: false,
    },
  });

  await prisma.integration.create({
    data: {
      businessId: business.id,
      type: industry.integration.type,
      name: industry.integration.name,
      enabled: false,
      config: industry.integration.config,
    },
  });

  await prisma.memory.create({
    data: {
      businessId: business.id,
      type: 'LONG_TERM',
      key: industry.memory.key,
      content: industry.memory.content,
    },
  });

  console.log(
    `Seed OK [${industry.slug}]. ${industry.business.name} id=${business.id}`,
  );
}

async function main() {
  const slug = parseIndustry(process.argv);
  const industry = industrySeeds[slug];
  await seedIndustry(industry);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
