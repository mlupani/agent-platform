import { type IndustrySeed, weeklyHours } from '../types';

export const clinicaDentalSeed: IndustrySeed = {
  slug: 'clinica-dental',
  type: 'CLINIC',
  business: {
    name: 'Clínica Dental Alvear',
    slug: 'clinica-dental-alvear',
    description:
      'Clínica odontológica en Recoleta: consultas, limpiezas, blanqueamiento, extracciones y ortodoncia.',
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es',
    address: 'Av. Alvear 1520, Recoleta, CABA',
    phone: '+54 11 4813-7700',
    whatsapp: '+5491148137700',
    email: 'turnos@alveardental.test',
    website: 'https://alveardental.test',
    instagram: '@alvear.dental',
    additionalInfo:
      'Turno previo. Traé estudios previos si los tenés. Avisá alergias a anestesia o medicamentos. Obra social: consultar cobertura al reservar.',
    defaultMessages: {
      welcome:
        'Hola, soy el asistente de Clínica Dental Alvear. ¿Querés sacar un turno de consulta, limpieza u otro tratamiento?',
      appointmentConfirmation:
        'Tu turno odontológico quedó confirmado. Llegá 10 minutos antes con DNI.',
      appointmentCancellation:
        'Cancelamos tu turno. Cuando quieras, te ayudo a coordinar otro.',
      handoff:
        'Te derivo con recepción de Clínica Dental Alvear para que te den más detalle.',
    },
    rules: {
      neverInventPrices: true,
      escalateIfUnsure: true,
    },
  },
  weeklyHours: weeklyHours({
    0: [
      { start: '09:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    1: [
      { start: '09:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    2: [
      { start: '09:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    3: [
      { start: '09:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    4: [
      { start: '09:00', end: '13:00' },
      { start: '14:30', end: '19:00' },
    ],
    5: [{ start: '09:00', end: '13:00' }],
    6: 'closed',
  }),
  services: [
    {
      name: 'Consulta odontológica',
      description: 'Evaluación, diagnóstico y plan de tratamiento.',
      durationMinutes: 30,
      price: 20000,
      priceDescription: '$20.000',
      sortOrder: 1,
    },
    {
      name: 'Limpieza / tartrectomía',
      description: 'Higiene profesional, control de placa y fluoración.',
      durationMinutes: 45,
      price: 28000,
      priceDescription: '$28.000',
      sortOrder: 2,
    },
    {
      name: 'Blanqueamiento dental',
      description: 'Blanqueamiento en consultorio. Requiere evaluación previa.',
      durationMinutes: 75,
      price: 65000,
      priceDescription: '$65.000',
      sortOrder: 3,
    },
    {
      name: 'Obturación (empaste)',
      description: 'Restauración de caries. El precio puede variar según piezas.',
      durationMinutes: 50,
      price: 35000,
      priceDescription: 'Desde $35.000',
      sortOrder: 4,
    },
    {
      name: 'Extracción simple',
      description: 'Extracción de pieza dental sin cirugía compleja.',
      durationMinutes: 40,
      price: 40000,
      priceDescription: 'Desde $40.000',
      sortOrder: 5,
    },
    {
      name: 'Consulta de ortodoncia',
      description: 'Evaluación para brackets o alineadores. Incluye revisión clínica.',
      durationMinutes: 40,
      price: 25000,
      priceDescription: '$25.000',
      sortOrder: 6,
    },
    {
      name: 'Endodoncia',
      description:
        'Tratamiento de conducto. Se confirma cantidad de sesiones en la consulta.',
      durationMinutes: 90,
      price: 90000,
      priceDescription: 'Desde $90.000',
      sortOrder: 7,
    },
    {
      name: 'Urgencia odontológica',
      description: 'Dolor agudo, fractura o inflamación. Sujeto a hueco del día.',
      durationMinutes: 30,
      price: 30000,
      priceDescription: '$30.000',
      sortOrder: 8,
    },
  ],
  faq: `# Preguntas frecuentes — Clínica Dental Alvear

## Sobre la clínica
Clínica Dental Alvear está en Recoleta, CABA.
Atendemos consultas, limpiezas, blanqueamiento, obturaciones, extracciones, ortodoncia y endodoncia, con turno previo.

## Horarios
Lunes a viernes: 09:00 a 13:00 y 14:30 a 19:00.
Sábados: 09:00 a 13:00.
Domingos cerrado.
Urgencias: se intenta dar hueco el mismo día dentro del horario de atención.

## Contacto
WhatsApp: +54 11 4813-7700
Teléfono: +54 11 4813-7700
Email: turnos@alveardental.test
Instagram: @alvear.dental
Dirección: Av. Alvear 1520, Recoleta, CABA

## Servicios y precios orientativos
- Consulta odontológica: 30 min — $20.000
- Limpieza / tartrectomía: 45 min — $28.000
- Blanqueamiento dental: 75 min — $65.000
- Obturación (empaste): 50 min — desde $35.000
- Extracción simple: 40 min — desde $40.000
- Consulta de ortodoncia: 40 min — $25.000
- Endodoncia: 90 min — desde $90.000
- Urgencia odontológica: 30 min — $30.000
Obra social y prepaga: consultar cobertura al reservar. Los precios particulares pueden variar según complejidad.

## Turnos
Se reserva con turno previo (WhatsApp o el asistente virtual).
Llegá 10 minutos antes con DNI. Si tenés radiografías o estudios, tráelos.
Cancelaciones: con al menos 6 horas de anticipación.

## Políticas
No compartimos datos de pacientes con terceros.
No damos diagnósticos médicos por chat: para dolor fuerte, hinchazón o sangrado, ofrecemos urgencia o derivamos a recepción.
`,
  knowledgeBase: {
    name: 'Conocimiento Alvear Dental',
    description: 'Horarios, prestaciones, precios y políticas de la clínica',
  },
  agent: {
    name: 'Asistente Alvear',
    description: 'Asistente virtual de Clínica Dental Alvear',
    tone: 'professional_warm',
    customInstructions:
      'Hablá en español rioplatense, profesional y cálido. Ayudá a sacar turnos odontológicos. No inventes precios, coberturas de obra social ni diagnósticos. Si hay dolor fuerte, inflamación o un caso clínico complejo, ofrecé urgencia o derivá a recepción.',
    personality: 'Profesional, tranquilizadora y clara, como recepción de una clínica.',
    systemPrompt: `Sos el asistente virtual de Clínica Dental Alvear, una clínica odontológica en Recoleta.
Ayudá con horarios, prestaciones, precios orientativos, FAQs y reservas de turnos.
Si no sabés algo, no lo inventes. No des diagnósticos médicos.
Si el paciente quiere hablar con recepción o un odontólogo, usá requestHumanAssistance.
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
    webhookUrl: 'https://n8n.example.test/webhook/alvear-lead',
  },
  integration: {
    type: 'n8n',
    name: 'n8n demo',
    config: { baseUrl: 'https://n8n.example.test' },
  },
  memory: {
    key: 'tone',
    content:
      'En Clínica Dental Alvear prefieren un tono profesional y cálido, en español rioplatense. Priorizar turnos claros y no diagnosticar por chat.',
  },
};
