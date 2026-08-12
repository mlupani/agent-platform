import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DEFAULT_CONFIGURED_MESSAGES } from '../src/common/constants';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

/** Horarios típicos de un centro de estética chico. 0=lun … 6=dom */
function aestheticsWeeklyHours(): Array<{
  dayOfWeek: number;
  isClosed: boolean;
  ranges: Array<{ start: string; end: string }>;
}> {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
    if (dayOfWeek === 6) {
      return { dayOfWeek, isClosed: true, ranges: [] };
    }
    if (dayOfWeek === 5) {
      return {
        dayOfWeek,
        isClosed: false,
        ranges: [{ start: '09:00', end: '14:00' }],
      };
    }
    return {
      dayOfWeek,
      isClosed: false,
      ranges: [
        { start: '10:00', end: '13:00' },
        { start: '14:30', end: '19:00' },
      ],
    };
  });
}

const FAQ = `# Preguntas frecuentes — Lumina Estética

## Sobre el local
Lumina Estética es un centro de belleza pequeño en Palermo, CABA.
Trabajamos pestañas, cejas, uñas, cortes y peinados, con atención personalizada y turno previo.

## Horarios
Lunes a viernes: 10:00 a 13:00 y 14:30 a 19:00.
Sábados: 09:00 a 14:00.
Domingos cerrado.

## Contacto
WhatsApp: +54 11 5555-8899
Teléfono: +54 11 5555-8899
Email: hola@luminaestetica.test
Instagram: @lumina.estetica
Dirección: Thames 2450, Palermo, CABA

## Servicios y precios orientativos
- Lifting de pestañas: 45 min — $18.000
- Extensiones de pestañas (clásicas): 90 min — $32.000
- Diseño y perfilado de cejas: 30 min — $12.000
- Manicura semipermanente: 60 min — $16.000
- Pedicura spa: 75 min — $22.000
- Corte de cabello (dama): 45 min — $15.000
- Brushing / peinado: 40 min — $12.000
- Coloración parcial (mechas): 120 min — desde $45.000 (consultar)
Los precios pueden variar según largo, técnica o productos. Confirmamos al reservar.

## Turnos
Se reserva con turno previo (WhatsApp o el asistente virtual).
Llegá 5 minutos antes. Si vas a llegar tarde, avisanos.
Cancelaciones: con al menos 4 horas de anticipación.

## Políticas
No compartimos datos de clientas/clientes con terceros.
Si el pedido requiere una persona del equipo (coloración compleja, alergias, reclamos), se deriva a un humano.
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

  const weekly = aestheticsWeeklyHours();
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
      name: 'Lumina Estética',
      slug: 'lumina-estetica',
      description:
        'Centro de estética pequeño en Palermo: pestañas, cejas, uñas, cortes y peinados. Atención con turno previo.',
      type: 'OTHER',
      timezone: 'America/Argentina/Buenos_Aires',
      language: 'es',
      address: 'Thames 2450, Palermo, CABA',
      phone: '+54 11 5555-8899',
      whatsapp: '+5491155558899',
      email: 'hola@luminaestetica.test',
      website: 'https://luminaestetica.test',
      instagram: '@lumina.estetica',
      additionalInfo:
        'Turno previo obligatorio. Traé el pelo limpio si venís a corte o peinado. Avisá alergias a productos o adhesivos.',
      openingHours,
      defaultMessages: {
        ...DEFAULT_CONFIGURED_MESSAGES,
        welcome:
          '¡Hola! Soy el asistente de Lumina Estética. ¿Querés reservar un turno de pestañas, uñas, cejas o cabello?',
        appointmentConfirmation:
          '¡Listo! Tu turno quedó confirmado. Te esperamos 5 minutos antes. Si necesitás cambiarlo, avisame.',
        appointmentCancellation:
          'Tu turno fue cancelado. Cuando quieras, te ayudo a sacar uno nuevo.',
        handoff:
          'Te derivo con alguien del equipo de Lumina para que te ayude con eso.',
      },
      rules: {
        neverInventPrices: true,
        escalateIfUnsure: true,
      },
      allowedModels: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini'],
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
        name: 'Lifting de pestañas',
        description:
          'Curvado natural de pestañas con duración aproximada de 4 a 6 semanas.',
        durationMinutes: 45,
        price: 18000,
        priceDescription: '$18.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 1,
      },
      {
        businessId: business.id,
        name: 'Extensiones de pestañas',
        description:
          'Extensiones clásicas pelo a pelo. Ideal para mirada definida.',
        durationMinutes: 90,
        price: 32000,
        priceDescription: '$32.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 2,
      },
      {
        businessId: business.id,
        name: 'Diseño y perfilado de cejas',
        description: 'Diseño, depilación y perfilado según el rostro.',
        durationMinutes: 30,
        price: 12000,
        priceDescription: '$12.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 3,
      },
      {
        businessId: business.id,
        name: 'Manicura semipermanente',
        description: 'Limpieza, limado, cutículas y esmaltado semipermanente.',
        durationMinutes: 60,
        price: 16000,
        priceDescription: '$16.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 4,
      },
      {
        businessId: business.id,
        name: 'Pedicura spa',
        description: 'Pedicura completa con exfoliación e hidratación.',
        durationMinutes: 75,
        price: 22000,
        priceDescription: '$22.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 5,
      },
      {
        businessId: business.id,
        name: 'Corte de cabello',
        description: 'Corte y lavado. Consultá si querés peinado incluido.',
        durationMinutes: 45,
        price: 15000,
        priceDescription: '$15.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 6,
      },
      {
        businessId: business.id,
        name: 'Brushing / peinado',
        description: 'Secado y peinado con brushing.',
        durationMinutes: 40,
        price: 12000,
        priceDescription: '$12.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 7,
      },
      {
        businessId: business.id,
        name: 'Coloración / mechas',
        description:
          'Coloración parcial o mechas. El precio final depende del largo y la técnica; se confirma en el local.',
        durationMinutes: 120,
        price: 45000,
        priceDescription: 'Desde $45.000',
        enabled: true,
        requiresAppointment: true,
        sortOrder: 8,
      },
    ],
  });

  const knowledgeBase = await prisma.knowledgeBase.create({
    data: {
      businessId: business.id,
      name: 'Conocimiento Lumina',
      description: 'Horarios, servicios, precios y políticas del centro',
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
    { name: 'sendWhatsAppMessage', risk: 'WRITE', requireConfirmation: false },
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
      name: 'Asistente Lumina',
      description: 'Asistente virtual de Lumina Estética',
      provider: 'openai',
      model: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4.1-mini',
      tone: 'friendly',
      customInstructions:
        'Hablá en español rioplatense, cálida y clara. Ayudá a elegir servicio y a sacar turno. No inventes precios ni horarios: usá las herramientas. Si preguntan por coloración compleja o alergias, ofrecé derivar a una persona del equipo.',
      personality: 'Cercana, ordenada y amable, como la recepcionista del salón.',
      systemPrompt: `Sos el asistente virtual de Lumina Estética, un centro de belleza pequeño en Palermo (pestañas, cejas, uñas, cortes y peinados).
Ayudá con horarios, servicios, precios orientativos, FAQs y reservas.
Si no sabés algo, no lo inventes.
Si la clienta quiere hablar con alguien del equipo, usá requestHumanAssistance.
Usá getServices, getOpeningHours y checkAvailability antes de afirmar disponibilidad o precios.
Para reservar usá createAppointment solo con un horario devuelto por checkAvailability.
Pedí nombre y, si es posible, teléfono o email para la confirmación.
Si dio email, después de reservar usá sendEmail para confirmar el turno.
Si pide confirmación por WhatsApp o dio teléfono, usá sendWhatsAppMessage.
Usá createLead cuando deje datos de contacto sin cerrar turno.`,
      temperature: 0.4,
      maxSteps: 8,
      enabledTools: tools.map((tool) => tool.name),
      enabledChannels: ['WEB', 'WHATSAPP', 'PLAYGROUND'],
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
      title: 'FAQ Lumina Estética',
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
      webhookUrl: 'https://n8n.example.test/webhook/lumina-lead',
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
        'Las clientas de Lumina Estética prefieren respuestas cálidas, breves y en español rioplatense. Priorizar turnos claros (servicio + día + hora).',
    },
  });

  console.log(
    `Seed OK. Lumina Estética id=${business.id} (centro de estética de prueba)`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
