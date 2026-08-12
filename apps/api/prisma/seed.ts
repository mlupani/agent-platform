import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import {
  DEFAULT_CONFIGURED_MESSAGES,
  defaultWeeklyHours,
} from '../src/common/constants';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

const FAQ = `# Preguntas frecuentes - Demo Business

## Horarios
Abrimos de lunes a viernes de 09:00 a 13:00 y 14:00 a 18:00. Sábados de 10:00 a 14:00.
Domingos cerrado.

## Contacto
Email: hola@demobusiness.test
Teléfono: +54 11 5555-1234

## Servicios
Consulta inicial, seguimiento y asesoramiento general.
Para reservar, un asesor puede comunicarse a la brevedad.

## Políticas
No compartimos datos de clientes con terceros.
Si el caso requiere una persona, se deriva a un humano.
`;

async function main() {
  await prisma.appointment.deleteMany();
  await prisma.googleCalendarConfig.deleteMany();
  await prisma.whatsAppConfig.deleteMany();
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

  const weekly = defaultWeeklyHours();
  const legacyKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const openingHours = Object.fromEntries(
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

  const business = await prisma.business.create({
    data: {
      name: 'Demo Business',
      slug: 'demo-business',
      description:
        'Negocio ficticio para probar el template. Configurable desde el dashboard sin tocar código.',
      type: 'OTHER',
      timezone: 'America/Argentina/Buenos_Aires',
      language: 'es',
      address: 'Av. Ejemplo 123, CABA',
      phone: '+54 11 5555-1234',
      whatsapp: '+5491155551234',
      email: 'hola@demobusiness.test',
      website: 'https://demobusiness.test',
      instagram: '@demobusiness',
      additionalInfo: 'Atención con turno previo preferentemente.',
      openingHours,
      defaultMessages: { ...DEFAULT_CONFIGURED_MESSAGES },
      rules: {
        neverInventPrices: true,
        escalateIfUnsure: true,
      },
      allowedModels: ['gpt-4.1-mini', 'gpt-4o-mini'],
    },
  });

  await prisma.businessHour.createMany({
    data: weekly.map((day) => ({
      businessId: business.id,
      dayOfWeek: day.dayOfWeek,
      isClosed: day.isClosed,
      ranges: day.ranges,
    })),
  });

  await prisma.service.createMany({
    data: [
      {
        businessId: business.id,
        name: 'Consulta inicial',
        description: 'Primera evaluación y orientación.',
        durationMinutes: 30,
        price: 15000,
        priceDescription: '$15.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 1,
      },
      {
        businessId: business.id,
        name: 'Seguimiento',
        description: 'Control o seguimiento de un caso existente.',
        durationMinutes: 20,
        price: 10000,
        priceDescription: '$10.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 2,
      },
      {
        businessId: business.id,
        name: 'Asesoramiento especial',
        description: 'Casos que requieren más tiempo. Precio a confirmar.',
        durationMinutes: 60,
        price: null,
        priceDescription: 'Consultar precio',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 3,
      },
    ],
  });

  const knowledgeBase = await prisma.knowledgeBase.create({
    data: {
      businessId: business.id,
      name: 'Conocimiento principal',
      description: 'Información que conoce tu asistente',
    },
  });

  const tools = [
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
    { name: 'triggerAutomation', risk: 'WRITE', requireConfirmation: false },
  ];

  await prisma.toolConfig.createMany({
    data: tools.map((tool) => ({
      businessId: business.id,
      ...tool,
    })),
  });

  await prisma.agentConfig.create({
    data: {
      businessId: business.id,
      knowledgeBaseId: knowledgeBase.id,
      name: 'Asistente Demo',
      description: 'Asistente virtual del negocio demo',
      provider: 'openai',
      model: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4.1-mini',
      tone: 'professional_warm',
      customInstructions:
        'Sé claro, amable y breve. No inventes precios ni horarios: usá las herramientas.',
      personality: 'Cercano, claro y profesional.',
      systemPrompt: `Sos el asistente virtual de Demo Business.
Ayudá con información general, horarios, servicios, FAQs y captura de leads.
Si no sabés algo, no lo inventes.
Si el usuario quiere hablar con una persona, usá requestHumanAssistance.
Usá getServices, getOpeningHours y checkAvailability antes de afirmar disponibilidad o precios.
Para reservar usá createAppointment solo con un horario devuelto por checkAvailability.
Si el usuario dio email, después de reservar usá sendEmail para confirmar el turno.
Usá createLead cuando el usuario deje nombre, email o teléfono.`,
      temperature: 0.3,
      maxSteps: 8,
      enabledTools: tools.map((tool) => tool.name),
      enabledChannels: ['WEB', 'WHATSAPP'],
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
      title: 'FAQ Demo Business',
      source: 'seed-faq.md',
      mimeType: 'text/markdown',
      category: 'faq',
      status: 'pending',
      content: FAQ,
    },
  });

  const chunks = FAQ.split(/\n(?=##\s+)/)
    .map((part) => part.trim())
    .filter(Boolean);

  const createdChunks = await Promise.all(
    chunks.map((content, index) =>
      prisma.documentChunk.create({
        data: {
          documentId: document.id,
          businessId: business.id,
          content,
          source: 'seed-faq.md',
          category: 'faq',
          page: index + 1,
        },
      }),
    ),
  );

  if (process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const model =
        process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
      const response = await client.embeddings.create({
        model,
        input: chunks,
      });
      for (let i = 0; i < createdChunks.length; i += 1) {
        const embedding = response.data[i]?.embedding;
        if (!embedding) continue;
        const literal = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
          literal,
          createdChunks[i].id,
        );
      }
      await prisma.document.update({
        where: { id: document.id },
        data: { status: 'ready' },
      });
      console.log(`Seed FAQ embeddings OK (${createdChunks.length} chunks)`);
    } catch (error) {
      console.warn(
        'Seed FAQ sin embeddings (OpenAI falló). Reindexá desde el dashboard.',
        error instanceof Error ? error.message : error,
      );
      await prisma.document.update({
        where: { id: document.id },
        data: { status: 'failed' },
      });
    }
  } else {
    console.warn(
      'OPENAI_API_KEY ausente: FAQ seed sin embeddings. Reindexá desde Knowledge.',
    );
  }

  await prisma.automation.create({
    data: {
      businessId: business.id,
      name: 'notify-new-lead',
      description: 'Webhook de ejemplo para notificar un lead en n8n',
      webhookUrl: 'https://n8n.example.test/webhook/demo-lead',
      enabled: false,
    },
  });

  await prisma.integration.create({
    data: {
      businessId: business.id,
      type: 'n8n',
      name: 'n8n demo',
      enabled: false,
      config: { baseUrl: 'https://n8n.example.test' },
    },
  });

  await prisma.memory.create({
    data: {
      businessId: business.id,
      type: 'LONG_TERM',
      key: 'tone',
      content:
        'Los clientes de Demo Business prefieren respuestas breves y en español rioplatense.',
    },
  });

  console.log(`Seed OK. Demo Business id=${business.id} (single-business template)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
