import { type IndustrySeed, weeklyHours } from '../types';

export const salonDeEventosSeed: IndustrySeed = {
  slug: 'salon-de-eventos',
  type: 'OTHER',
  business: {
    name: 'Salón Magnolia',
    slug: 'salon-magnolia',
    description:
      'Salón de eventos en Palermo: casamientos, 15 años, cumpleaños, bautismos y eventos corporativos. Visitas con cita previa.',
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es',
    address: 'Gorriti 4780, Palermo, CABA',
    phone: '+54 11 4832-6610',
    whatsapp: '+5491148326610',
    email: 'hola@salonmagnolia.test',
    website: 'https://salonmagnolia.test',
    instagram: '@salon.magnolia',
    additionalInfo:
      'Visitas al salón con cita previa. Capacidad de 80 a 180 personas (salón techado + jardín). Los precios de paquetes son orientativos: se confirman según fecha, cantidad de invitados y menú. Seña del 30% para reservar fecha.',
    defaultMessages: {
      welcome:
        'Hola, soy el asistente de Salón Magnolia. ¿Querés visitar el salón, consultar un paquete o ver disponibilidad para un evento?',
      appointmentConfirmation:
        'Tu visita o reserva quedó confirmada. Te esperamos en el horario acordado. Si no podés llegar, avisanos.',
      appointmentCancellation:
        'Cancelamos la visita. Cuando quieras, te ayudo a coordinar otra.',
      handoff:
        'Te derivo con un coordinador de Salón Magnolia para que te dé más detalle del evento.',
    },
    rules: {
      neverInventPrices: true,
      escalateIfUnsure: true,
    },
  },
  weeklyHours: weeklyHours({
    0: [{ start: '10:00', end: '18:00' }],
    1: [{ start: '10:00', end: '18:00' }],
    2: [{ start: '10:00', end: '18:00' }],
    3: [{ start: '10:00', end: '18:00' }],
    4: [{ start: '10:00', end: '18:00' }],
    5: [{ start: '10:00', end: '14:00' }],
    6: 'closed',
  }),
  services: [
    {
      name: 'Visita al salón',
      description:
        'Recorrido del salón techado y el jardín, con un coordinador. Ideal para conocer el espacio antes de reservar.',
      durationMinutes: 40,
      price: 0,
      priceDescription: 'Sin cargo',
      sortOrder: 1,
    },
    {
      name: 'Asesoramiento de evento',
      description:
        'Reunión para armar fecha, cantidad de invitados, paquete y presupuesto orientativo.',
      durationMinutes: 45,
      price: 0,
      priceDescription: 'Sin cargo',
      sortOrder: 2,
    },
    {
      name: 'Degustación de menú',
      description:
        'Prueba de entradas, plato principal y postre del catering propio. Se descuenta si se contrata el evento.',
      durationMinutes: 60,
      price: 25000,
      priceDescription: '$25.000 (a cuenta si se contrata)',
      sortOrder: 3,
    },
    {
      name: 'Paquete social',
      description:
        'Alquiler de salón 8 hs para cumpleaños, bautismos o reuniones. Incluye mobiliario básico y coordinación.',
      durationMinutes: 480,
      price: 850000,
      priceDescription: 'Desde $850.000 (según invitados y fecha)',
      sortOrder: 4,
    },
    {
      name: 'Paquete casamiento / 15 años',
      description:
        'Alquiler 10 hs con jardín, iluminación, coordinación y menú a elección. Capacidad hasta 180 personas.',
      durationMinutes: 600,
      price: 1800000,
      priceDescription: 'Desde $1.800.000 (según invitados, fecha y menú)',
      sortOrder: 5,
    },
    {
      name: 'Evento corporativo',
      description:
        'Coffee break, almuerzo o after office. Salón adaptable a reuniones, lanzamientos y capacitaciones.',
      durationMinutes: 240,
      price: 450000,
      priceDescription: 'Desde $450.000 (según duración e invitados)',
      sortOrder: 6,
    },
  ],
  faq: `# Preguntas frecuentes — Salón Magnolia

## Sobre el salón
Salón Magnolia es un espacio para eventos en Palermo, CABA.
Tenemos salón techado y jardín. Capacidad de 80 a 180 personas, según el tipo de evento y el montaje.
Hacemos casamientos, 15 años, cumpleaños, bautismos y eventos corporativos.

## Horarios de atención (oficina y visitas)
Lunes a viernes: 10:00 a 18:00.
Sábados: 10:00 a 14:00.
Domingos cerrado para visitas (los eventos sí se realizan los fines de semana).
Las visitas al salón se agendan dentro de esos horarios.

## Contacto
WhatsApp: +54 11 4832-6610
Teléfono: +54 11 4832-6610
Email: hola@salonmagnolia.test
Instagram: @salon.magnolia
Dirección: Gorriti 4780, Palermo, CABA

## Servicios y valores orientativos
- Visita al salón: 40 min — sin cargo
- Asesoramiento de evento: 45 min — sin cargo
- Degustación de menú: 60 min — $25.000 (a cuenta si se contrata)
- Paquete social (8 hs): desde $850.000
- Paquete casamiento / 15 años (10 hs): desde $1.800.000
- Evento corporativo: desde $450.000
Los precios finales dependen de la fecha, la cantidad de invitados y el menú. No inventamos un presupuesto cerrado sin esos datos.

## Reservas y seña
Para bloquear una fecha se pide una seña del 30%.
El saldo se acuerda en el contrato (habitualmente 15 días antes del evento).
Cancelaciones de visita: con al menos 4 horas de anticipación.
Cancelación de evento: según contrato; se deriva a un coordinador.

## Qué incluye el alquiler
Mobiliario básico (mesas, sillas, vajilla estándar), baños, climatización y un coordinador el día del evento.
Catering propio o de proveedores autorizados. DJ, decoración floral y fotógrafo se cotizan aparte o los puede traer el cliente.

## Políticas
No compartimos datos de clientes con terceros.
Si preguntan por una fecha concreta, disponibilidad de un fin de semana pico o un presupuesto cerrado, usá las herramientas y, si no alcanza, derivá a un coordinador.
`,
  knowledgeBase: {
    name: 'Conocimiento Magnolia',
    description:
      'Horarios, paquetes, precios orientativos y políticas del salón de eventos',
  },
  agent: {
    name: 'Asistente Magnolia',
    description: 'Asistente virtual de Salón Magnolia',
    tone: 'professional_warm',
    customInstructions:
      'Hablá en español rioplatense, profesional y cálido. Ayudá a agendar visitas, asesoramiento o degustaciones. No inventes precios finales ni disponibilidad de una fecha concreta: usá herramientas y, si falta dato (invitados, tipo de evento, fecha), preguntá. Presupuestos cerrados y contratos se derivan a un coordinador.',
    personality:
      'Profesional, cálida y concreta, como una coordinadora de eventos del salón.',
    systemPrompt: `Sos el asistente virtual de Salón Magnolia, un salón de eventos en Palermo (casamientos, 15 años, cumpleaños y corporativos).
Ayudá con horarios de visita, paquetes, precios orientativos, FAQs y reservas de visitas o reuniones.
Si no sabés algo, no lo inventes. Nunca inventes un presupuesto cerrado ni la disponibilidad de una fecha de evento sin chequear.
Si el cliente quiere hablar con un coordinador, usá requestHumanAssistance.
Usá getServices, getOpeningHours y checkAvailability antes de afirmar disponibilidad.
Para agendar usá createAppointment solo con un horario devuelto por checkAvailability.
Pedí nombre y, si es posible, teléfono o email para la confirmación.
Si dio email, después de reservar usá sendEmail para confirmar.
Si pide confirmación por WhatsApp o dio teléfono, usá sendWhatsAppMessage.
createAppointment guarda el lead al reservar. Usá createLead solo si deja datos de contacto (fecha tentativa, cantidad de invitados, tipo de evento) sin cerrar una visita.`,
  },
  automation: {
    name: 'notify-new-lead',
    description: 'Webhook de ejemplo para notificar un lead en n8n',
    webhookUrl: 'https://n8n.example.test/webhook/magnolia-lead',
  },
  integration: {
    type: 'n8n',
    name: 'n8n demo',
    config: { baseUrl: 'https://n8n.example.test' },
  },
  memory: {
    key: 'tone',
    content:
      'En Salón Magnolia prefieren un tono profesional y cálido, en español rioplatense. Priorizar agendar una visita o reunión y no inventar presupuestos cerrados ni disponibilidad de fechas de evento.',
  },
};
