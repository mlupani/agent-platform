import { type IndustrySeed, weeklyHours } from '../types';

export const peluqueriaSeed: IndustrySeed = {
  slug: 'peluqueria',
  type: 'OTHER',
  business: {
    name: 'Nudo Peluquería',
    slug: 'nudo-peluqueria',
    description:
      'Peluquería en Villa Crespo: cortes, color, mechas, brushing y tratamientos. Turno previo.',
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es',
    address: 'Corrientes 5230, Villa Crespo, CABA',
    phone: '+54 11 4867-2210',
    whatsapp: '+5491148672210',
    email: 'hola@nudopeluqueria.test',
    website: 'https://nudopeluqueria.test',
    instagram: '@nudo.peluqueria',
    additionalInfo:
      'Turno previo. Si venís a color o mechas, llegá con el pelo sin acondicionador pesado. Avisá si te hiciste un alisado reciente.',
    defaultMessages: {
      welcome:
        '¡Hola! Soy el asistente de Nudo Peluquería. ¿Buscás corte, color, mechas o brushing?',
      appointmentConfirmation:
        '¡Listo! Tu turno en Nudo quedó confirmado. Te esperamos 5 minutos antes.',
      appointmentCancellation:
        'Cancelamos tu turno. Cuando quieras, te ayudo a sacar otro.',
      handoff: 'Te paso con alguien del equipo de Nudo para que te asesore mejor.',
    },
    rules: {
      neverInventPrices: true,
      escalateIfUnsure: true,
    },
  },
  weeklyHours: weeklyHours({
    0: 'closed',
    1: [
      { start: '10:00', end: '14:00' },
      { start: '15:00', end: '20:00' },
    ],
    2: [
      { start: '10:00', end: '14:00' },
      { start: '15:00', end: '20:00' },
    ],
    3: [
      { start: '10:00', end: '14:00' },
      { start: '15:00', end: '20:00' },
    ],
    4: [
      { start: '10:00', end: '14:00' },
      { start: '15:00', end: '20:00' },
    ],
    5: [{ start: '09:00', end: '18:00' }],
    6: 'closed',
  }),
  services: [
    {
      name: 'Corte dama',
      description: 'Lavado, corte y brushing liviano.',
      durationMinutes: 50,
      price: 18000,
      priceDescription: '$18.000',
      sortOrder: 1,
    },
    {
      name: 'Corte caballero',
      description: 'Corte con máquina y tijera. Incluye lavado.',
      durationMinutes: 35,
      price: 12000,
      priceDescription: '$12.000',
      sortOrder: 2,
    },
    {
      name: 'Brushing / peinado',
      description: 'Secado y brushing. Ideal para eventos o mantenimiento.',
      durationMinutes: 40,
      price: 14000,
      priceDescription: '$14.000',
      sortOrder: 3,
    },
    {
      name: 'Coloración raíz',
      description: 'Retoque de raíz. El precio final puede variar según largo.',
      durationMinutes: 90,
      price: 32000,
      priceDescription: 'Desde $32.000',
      sortOrder: 4,
    },
    {
      name: 'Mechas / balayage',
      description:
        'Mechas, balayage o babylights. Se confirma técnica y precio en el salón.',
      durationMinutes: 150,
      price: 55000,
      priceDescription: 'Desde $55.000',
      sortOrder: 5,
    },
    {
      name: 'Tratamiento nutritivo',
      description: 'Hidratación profunda o botox capilar según el cabello.',
      durationMinutes: 45,
      price: 20000,
      priceDescription: '$20.000',
      sortOrder: 6,
    },
    {
      name: 'Alisado / keratina',
      description:
        'Alisado progresivo o keratina. Requiere diagnóstico previo del cabello.',
      durationMinutes: 180,
      price: 70000,
      priceDescription: 'Desde $70.000',
      sortOrder: 7,
    },
    {
      name: 'Barba / perfilado',
      description: 'Perfilado de barba con máquina y navaja.',
      durationMinutes: 25,
      price: 8000,
      priceDescription: '$8.000',
      sortOrder: 8,
    },
  ],
  faq: `# Preguntas frecuentes — Nudo Peluquería

## Sobre el local
Nudo Peluquería es un salón en Villa Crespo, CABA.
Hacemos cortes, color, mechas, brushing, tratamientos y barba, con turno previo.

## Horarios
Lunes cerrado.
Martes a viernes: 10:00 a 14:00 y 15:00 a 20:00.
Sábados: 09:00 a 18:00.
Domingos cerrado.

## Contacto
WhatsApp: +54 11 4867-2210
Teléfono: +54 11 4867-2210
Email: hola@nudopeluqueria.test
Instagram: @nudo.peluqueria
Dirección: Corrientes 5230, Villa Crespo, CABA

## Servicios y precios orientativos
- Corte dama: 50 min — $18.000
- Corte caballero: 35 min — $12.000
- Brushing / peinado: 40 min — $14.000
- Coloración raíz: 90 min — desde $32.000
- Mechas / balayage: 150 min — desde $55.000
- Tratamiento nutritivo: 45 min — $20.000
- Alisado / keratina: 180 min — desde $70.000
- Barba / perfilado: 25 min — $8.000
Color, mechas y alisados se confirman según largo y estado del cabello.

## Turnos
Reserva previa por WhatsApp o el asistente virtual.
Llegá 5 minutos antes. Si vas a llegar tarde, avisanos.
Cancelaciones: con al menos 4 horas de anticipación.

## Políticas
No compartimos datos de clientas/clientes con terceros.
Para coloración compleja, decoloración o cabello muy dañado, derivamos a una persona del equipo.
`,
  knowledgeBase: {
    name: 'Conocimiento Nudo',
    description: 'Horarios, servicios, precios y políticas de la peluquería',
  },
  agent: {
    name: 'Asistente Nudo',
    description: 'Asistente virtual de Nudo Peluquería',
    tone: 'friendly',
    customInstructions:
      'Hablá en español rioplatense, cercana y directa. Ayudá a elegir corte, color o brushing y a sacar turno. No inventes precios ni horarios. Si preguntan por decoloración, alisado en cabello dañado o un look muy específico, ofrecé derivar a una persona del equipo.',
    personality: 'Cercana, con onda de salón, ordenada para armar turnos.',
    systemPrompt: `Sos el asistente virtual de Nudo Peluquería, un salón en Villa Crespo (cortes, color, mechas, brushing y tratamientos).
Ayudá con horarios, servicios, precios orientativos, FAQs y reservas.
Si no sabés algo, no lo inventes.
Si la clienta quiere hablar con alguien del equipo, usá requestHumanAssistance.
Usá getServices, getOpeningHours y checkAvailability antes de afirmar disponibilidad o precios.
Para reservar usá createAppointment solo con un horario devuelto por checkAvailability.
Pedí nombre y, si es posible, teléfono o email para la confirmación.
Si dio email, después de reservar usá sendEmail para confirmar el turno.
Si pide confirmación por WhatsApp o dio teléfono, usá sendWhatsAppMessage para enviar la confirmación inmediata (no es un recordatorio programado; no prometas "te contacto antes de la clase").
createAppointment guarda el lead al reservar. Usá createLead solo si deja datos de contacto sin cerrar turno.`,
  },
  automation: {
    name: 'notify-new-lead',
    description: 'Webhook de ejemplo para notificar un lead en n8n',
    webhookUrl: 'https://n8n.example.test/webhook/nudo-lead',
  },
  integration: {
    type: 'n8n',
    name: 'n8n demo',
    config: { baseUrl: 'https://n8n.example.test' },
  },
  memory: {
    key: 'tone',
    content:
      'En Nudo Peluquería prefieren respuestas cálidas, breves y en español rioplatense. Priorizar servicio + día + hora, y aclarar que color/mechas se confirman según el cabello.',
  },
};
