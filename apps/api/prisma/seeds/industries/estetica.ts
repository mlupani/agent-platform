import { type IndustrySeed, weeklyHours } from '../types';

export const esteticaSeed: IndustrySeed = {
  slug: 'estetica',
  type: 'OTHER',
  business: {
    name: 'Lumina Estética',
    slug: 'lumina-estetica',
    description:
      'Centro de estética en Palermo: pestañas, cejas, uñas y tratamientos faciales. Atención con turno previo.',
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es',
    address: 'Thames 2450, Palermo, CABA',
    phone: '+54 11 5555-8899',
    whatsapp: '+5491155558899',
    email: 'hola@luminaestetica.test',
    website: 'https://luminaestetica.test',
    instagram: '@lumina.estetica',
    additionalInfo:
      'Turno previo obligatorio. Avisá alergias a productos, adhesivos o esmaltes.',
    defaultMessages: {
      welcome:
        '¡Hola! Soy el asistente de Lumina Estética. ¿Querés reservar pestañas, cejas, uñas o un facial?',
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
  },
  weeklyHours: weeklyHours({
    0: [
      { start: '10:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    1: [
      { start: '10:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    2: [
      { start: '10:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    3: [
      { start: '10:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    4: [
      { start: '10:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    5: [{ start: '09:00', end: '14:00' }],
    6: 'closed',
  }),
  services: [
    {
      name: 'Lifting de pestañas',
      description:
        'Curvado natural de pestañas con duración aproximada de 4 a 6 semanas.',
      durationMinutes: 45,
      price: 18000,
      priceDescription: '$18.000',
      sortOrder: 1,
    },
    {
      name: 'Extensiones de pestañas',
      description: 'Extensiones clásicas pelo a pelo. Ideal para mirada definida.',
      durationMinutes: 90,
      price: 32000,
      priceDescription: '$32.000',
      sortOrder: 2,
    },
    {
      name: 'Diseño y perfilado de cejas',
      description: 'Diseño, depilación y perfilado según el rostro.',
      durationMinutes: 30,
      price: 12000,
      priceDescription: '$12.000',
      sortOrder: 3,
    },
    {
      name: 'Laminado de cejas',
      description: 'Laminado para cejas peinadas y con volumen. Incluye nutrición.',
      durationMinutes: 50,
      price: 16000,
      priceDescription: '$16.000',
      sortOrder: 4,
    },
    {
      name: 'Manicura semipermanente',
      description: 'Limpieza, limado, cutículas y esmaltado semipermanente.',
      durationMinutes: 60,
      price: 16000,
      priceDescription: '$16.000',
      sortOrder: 5,
    },
    {
      name: 'Soft gel',
      description: 'Extensiones soft gel con forma a elección.',
      durationMinutes: 90,
      price: 26000,
      priceDescription: '$26.000',
      sortOrder: 6,
    },
    {
      name: 'Pedicura spa',
      description: 'Pedicura completa con exfoliación e hidratación.',
      durationMinutes: 75,
      price: 22000,
      priceDescription: '$22.000',
      sortOrder: 7,
    },
    {
      name: 'Limpieza facial',
      description: 'Limpieza profunda, extracción e hidratación según tipo de piel.',
      durationMinutes: 60,
      price: 28000,
      priceDescription: '$28.000',
      sortOrder: 8,
    },
  ],
  faq: `# Preguntas frecuentes — Lumina Estética

## Sobre el local
Lumina Estética es un centro de belleza pequeño en Palermo, CABA.
Trabajamos pestañas, cejas, uñas y faciales, con atención personalizada y turno previo.

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
- Laminado de cejas: 50 min — $16.000
- Manicura semipermanente: 60 min — $16.000
- Soft gel: 90 min — $26.000
- Pedicura spa: 75 min — $22.000
- Limpieza facial: 60 min — $28.000
Los precios pueden variar según técnica o productos. Confirmamos al reservar.

## Turnos
Se reserva con turno previo (WhatsApp o el asistente virtual).
Llegá 5 minutos antes. Si vas a llegar tarde, avisanos.
Cancelaciones: con al menos 4 horas de anticipación.

## Políticas
No compartimos datos de clientas/clientes con terceros.
Si el pedido requiere una persona del equipo (alergias, reclamos, diseños complejos), se deriva a un humano.
`,
  knowledgeBase: {
    name: 'Conocimiento Lumina',
    description: 'Horarios, servicios, precios y políticas del centro',
  },
  agent: {
    name: 'Asistente Lumina',
    description: 'Asistente virtual de Lumina Estética',
    tone: 'friendly',
    customInstructions:
      'Hablá en español rioplatense, cálida y clara. Ayudá a elegir servicio y a sacar turno. No inventes precios ni horarios: usá las herramientas. Si preguntan por alergias o un diseño muy complejo, ofrecé derivar a una persona del equipo.',
    personality: 'Cercana, ordenada y amable, como la recepcionista del salón.',
    systemPrompt: `Sos el asistente virtual de Lumina Estética, un centro de belleza pequeño en Palermo (pestañas, cejas, uñas y faciales).
Ayudá con horarios, servicios, precios orientativos, FAQs y reservas.
Si no sabés algo, no lo inventes.
Si la clienta quiere hablar con alguien del equipo, usá requestHumanAssistance.
Usá getServices, getOpeningHours y checkAvailability antes de afirmar disponibilidad o precios.
Para reservar usá createAppointment solo con un horario devuelto por checkAvailability.
Pedí nombre y, si es posible, teléfono o email para la confirmación.
Si dio email, después de reservar usá sendEmail para confirmar el turno.
Si pide confirmación por WhatsApp o dio teléfono, usá sendWhatsAppMessage.
createAppointment guarda el lead al reservar. Usá createLead solo si deja datos de contacto sin cerrar turno.`,
  },
  automation: {
    name: 'notify-new-lead',
    description: 'Webhook de ejemplo para notificar un lead en n8n',
    webhookUrl: 'https://n8n.example.test/webhook/lumina-lead',
  },
  integration: {
    type: 'n8n',
    name: 'n8n demo',
    config: { baseUrl: 'https://n8n.example.test' },
  },
  memory: {
    key: 'tone',
    content:
      'Las clientas de Lumina Estética prefieren respuestas cálidas, breves y en español rioplatense. Priorizar turnos claros (servicio + día + hora).',
  },
};
