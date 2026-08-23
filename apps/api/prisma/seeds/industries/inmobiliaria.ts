import { type IndustrySeed, weeklyHours } from '../types';

export const inmobiliariaSeed: IndustrySeed = {
  slug: 'inmobiliaria',
  type: 'REAL_ESTATE',
  business: {
    name: 'Norte Propiedades',
    slug: 'norte-propiedades',
    description:
      'Inmobiliaria en Belgrano: alquileres, ventas, tasaciones y visitas a propiedades.',
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es',
    address: 'Cabildo 2450, Belgrano, CABA',
    phone: '+54 11 4783-4400',
    whatsapp: '+5491147834400',
    email: 'hola@nortepropiedades.test',
    website: 'https://nortepropiedades.test',
    instagram: '@norte.propiedades',
    additionalInfo:
      'Atención con cita previa para visitas y tasaciones. Llevá DNI. Para alquileres pedimos documentación laboral al avanzar.',
    defaultMessages: {
      welcome:
        'Hola, soy el asistente de Norte Propiedades. ¿Buscás alquilar, comprar, vender o agendar una visita?',
      appointmentConfirmation:
        'Tu visita quedó confirmada. Te esperamos en el horario acordado. Si no podés llegar, avisanos.',
      appointmentCancellation:
        'Cancelamos la visita. Cuando quieras, te ayudo a coordinar otra.',
      handoff:
        'Te derivo con un asesor de Norte Propiedades para que te dé más detalle.',
    },
    rules: {
      neverInventPrices: true,
      escalateIfUnsure: true,
    },
  },
  weeklyHours: weeklyHours({
    0: [{ start: '09:00', end: '18:00' }],
    1: [{ start: '09:00', end: '18:00' }],
    2: [{ start: '09:00', end: '18:00' }],
    3: [{ start: '09:00', end: '18:00' }],
    4: [{ start: '09:00', end: '18:00' }],
    5: [{ start: '10:00', end: '13:00' }],
    6: 'closed',
  }),
  services: [
    {
      name: 'Visita a propiedad',
      description: 'Recorrido de un departamento o casa en agenda, con asesor.',
      durationMinutes: 40,
      price: 0,
      priceDescription: 'Sin cargo',
      sortOrder: 1,
    },
    {
      name: 'Asesoramiento alquiler',
      description:
        'Consulta para buscar alquiler: zona, presupuesto y requisitos.',
      durationMinutes: 30,
      price: 0,
      priceDescription: 'Sin cargo',
      sortOrder: 2,
    },
    {
      name: 'Asesoramiento compra / venta',
      description: 'Reunión para comprar o publicar una propiedad.',
      durationMinutes: 45,
      price: 0,
      priceDescription: 'Sin cargo',
      sortOrder: 3,
    },
    {
      name: 'Tasación',
      description: 'Visita técnica para estimar valor de mercado.',
      durationMinutes: 60,
      price: 45000,
      priceDescription: '$45.000 (a cuenta si se publica con nosotros)',
      sortOrder: 4,
    },
    {
      name: 'Gestión de alquiler',
      description:
        'Acompañamiento en contrato de alquiler. Honorarios según operación.',
      durationMinutes: 60,
      price: 0,
      priceDescription: 'Honorarios según operación',
      sortOrder: 5,
    },
    {
      name: 'Publicación de propiedad',
      description:
        'Armado de ficha, fotos y publicación en portales. Se coordina visita previa.',
      durationMinutes: 50,
      price: 0,
      priceDescription: 'Incluido si se firma exclusiva',
      sortOrder: 6,
    },
  ],
  faq: `# Preguntas frecuentes — Norte Propiedades

## Sobre la inmobiliaria
Norte Propiedades opera en Belgrano y zonas aledañas (Núñez, Colegiales, Palermo).
Trabajamos alquileres, ventas, tasaciones y visitas a propiedades.

## Horarios
Lunes a viernes: 09:00 a 18:00.
Sábados: 10:00 a 13:00.
Domingos cerrado.
Las visitas a propiedades se agendan dentro de esos horarios, salvo excepción coordinada.

## Contacto
WhatsApp: +54 11 4783-4400
Teléfono: +54 11 4783-4400
Email: hola@nortepropiedades.test
Instagram: @norte.propiedades
Dirección: Cabildo 2450, Belgrano, CABA

## Servicios y valores orientativos
- Visita a propiedad: 40 min — sin cargo
- Asesoramiento alquiler: 30 min — sin cargo
- Asesoramiento compra / venta: 45 min — sin cargo
- Tasación: 60 min — $45.000 (a cuenta si se publica con nosotros)
- Gestión de alquiler: honorarios según operación
- Publicación de propiedad: incluida si se firma exclusiva
Los honorarios de compraventa y alquiler se informan en la reunión. No inventamos precios de propiedades concretas sin ficha.

## Visitas y citas
Se agenda con cita previa.
Llevá DNI. Si vas a una visita de alquiler, es útil tener a mano ingresos aproximados.
Cancelaciones: con al menos 4 horas de anticipación.

## Políticas
No compartimos datos de clientes ni propietarios con terceros.
Si preguntan por una propiedad específica que no está en la base, se deriva a un asesor.
`,
  knowledgeBase: {
    name: 'Conocimiento Norte',
    description: 'Horarios, servicios, honorarios y políticas de la inmobiliaria',
  },
  agent: {
    name: 'Asistente Norte',
    description: 'Asistente virtual de Norte Propiedades',
    tone: 'professional_warm',
    customInstructions:
      'Hablá en español rioplatense, profesional y claro. Ayudá a agendar visitas, tasaciones o asesoramiento. No inventes precios de propiedades ni disponibilidad de un inmueble concreto: usá herramientas y, si no está en la base, derivá a un asesor.',
    personality: 'Profesional, cálida y concreta, como una asesora inmobiliaria.',
    systemPrompt: `Sos el asistente virtual de Norte Propiedades, una inmobiliaria en Belgrano (alquileres, ventas, tasaciones y visitas).
Ayudá con horarios, servicios, honorarios orientativos, FAQs y reservas de visitas o reuniones.
Si no sabés algo, no lo inventes. Nunca inventes el precio de una propiedad específica.
Si el cliente quiere hablar con un asesor, usá requestHumanAssistance.
Usá getServices, getOpeningHours y checkAvailability antes de afirmar disponibilidad.
Para agendar usá createAppointment solo con un horario devuelto por checkAvailability.
Pedí nombre y, si es posible, teléfono o email para la confirmación.
Si dio email, después de reservar usá sendEmail para confirmar.
Si pide confirmación por WhatsApp o dio teléfono, usá sendWhatsAppMessage.
createAppointment guarda el lead al reservar. Usá createLead solo si deja datos de contacto sin cerrar una cita.`,
  },
  automation: {
    name: 'notify-new-lead',
    description: 'Webhook de ejemplo para notificar un lead en n8n',
    webhookUrl: 'https://n8n.example.test/webhook/norte-lead',
  },
  integration: {
    type: 'n8n',
    name: 'n8n demo',
    config: { baseUrl: 'https://n8n.example.test' },
  },
  memory: {
    key: 'tone',
    content:
      'En Norte Propiedades prefieren un tono profesional y cálido, en español rioplatense. Priorizar agendar visita o reunión y no inventar precios de inmuebles.',
  },
};
