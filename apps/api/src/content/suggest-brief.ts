import type {
  ContentChannel,
  ContentMediaType,
  ContentObjective,
} from './content.types';

export const BRIEF_MAX_CHARS = 1800;

export const OBJECTIVE_LABEL: Record<ContentObjective, string> = {
  AUTOMATIC: 'Automático (elegí el ángulo más fuerte para el negocio)',
  SERVICE_PROMOTION: 'Promoción de servicio',
  OFFER: 'Oferta / promo',
  TIP: 'Consejo / tip útil',
  INFO: 'Informativo',
  SPECIAL_DATE: 'Fecha especial',
  CUSTOM: 'Personalizado',
};

export function sanitizeBrief(raw: string): string {
  let text = (raw ?? '').trim();
  if (!text) return '';

  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) text = fenced[1].trim();

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const fromJson = [
        parsed.instructions,
        parsed.guion,
        parsed.brief,
        parsed.script,
      ].find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      );
      if (fromJson) text = fromJson.trim();
    } catch {
      // texto plano
    }
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= BRIEF_MAX_CHARS) return text;

  const cut = text.slice(0, BRIEF_MAX_CHARS);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return (
    lastBreak > BRIEF_MAX_CHARS * 0.65 ? cut.slice(0, lastBreak) : cut
  ).trim();
}

export function buildBriefSystemPrompt(input: {
  mediaType: ContentMediaType;
  durationSeconds: number;
  objective: ContentObjective;
}): string {
  const objective = OBJECTIVE_LABEL[input.objective];
  if (input.mediaType === 'VIDEO') {
    return `Sos un director creativo de shorts para negocios locales de Argentina (Reels / TikTok / Status).
Tu trabajo es armar UN guion listo para que otra IA genere el video. Español rioplatense, concreto, vendible.

El video dura ${input.durationSeconds}s, vertical 9:16.
Objetivo: ${objective}.

Devolvé SOLO el guion, con estos bloques (títulos en mayúsculas):
IDEA
HOOK
VOZ
ESCENA
CIERRE
ON-SCREEN
LOOK

Reglas:
- IDEA: 1 o 2 frases. Ángulo específico de ESTE negocio, no genérico.
- HOOK: lo que se ve y se siente en el primer segundo. Pregunta, tensión o beneficio concreto.
- VOZ (OBLIGATORIO): siempre hay alguien que HABLA. Preferí un protagonista a cámara (dueño, staff o cliente) mirando a cámara. Si el rubro no admite persona en frame, usá locución en off clara.
- En VOZ escribí EXACTAMENTE las frases dichas, en español rioplatense, entre comillas. Deben entrar en ${input.durationSeconds}s (~2,5 palabras por segundo). 1 a 3 frases, naturales, vendibles.
- ESCENA: una sola acción principal continua mientras habla (planos, producto, lugar). Si hay protagonista, mostralo hablando. Cámara simple (fija o un movimiento suave). No apiles caminar + manos complejas + varios objetos. Si hay manos o utensilios, describí qué objeto, cómo se sostiene y un movimiento lento y estable.
- CIERRE: CTA accionable (reservar, escribir, pasar, pedir turno). La voz también lo dice.
- ON-SCREEN: dos líneas cortas (máx 8 palabras cada una): hook + CTA. Sin emojis.
- LOOK: estilo visual, luz, paleta, tono. NO pidas texto, logo ni watermark quemados en el video (eso va después).
- NUNCA armes un video mudo ni solo de producto/local sin voz.
- No inventes precios, % off ni fechas si el negocio no los dio.
- No uses hashtags ni copy de caption: esto es el brief de generación.
- Máximo ${BRIEF_MAX_CHARS} caracteres. Sin markdown, sin JSON, sin preámbulo.`;
  }

  return `Sos un director creativo de piezas de marketing para negocios locales de Argentina.
Tu trabajo es armar UN brief listo para que otra IA genere la imagen. Español rioplatense, concreto.

Objetivo: ${objective}.

Devolvé SOLO el brief, con estos bloques (títulos en mayúsculas):
IDEA
HEADLINE
COMPOSICIÓN
CTA
LOOK

Reglas:
- IDEA: ángulo específico de ESTE negocio.
- HEADLINE: pocas palabras, alto contraste, para la pieza.
- COMPOSICIÓN: qué se ve (hero, marca, jerarquía). Incluí logo o nombre del negocio.
- CTA: frase accionable corta.
- LOOK: estilo, luz, paleta, tono.
- No inventes precios ni % off si el negocio no los dio.
- Máximo ${BRIEF_MAX_CHARS} caracteres. Sin markdown, sin JSON, sin preámbulo.`;
}

export function buildBriefUserPrompt(input: {
  businessName: string;
  businessType: string;
  description: string | null;
  todayLabel: string;
  objective: ContentObjective;
  mediaType: ContentMediaType;
  durationSeconds: number;
  channels: ContentChannel[];
  selectedService: { name: string; description: string | null } | null;
  services: string;
  hours: string;
  brand: string;
  recent: string;
  hint?: string;
}): string {
  return [
    'NEGOCIO',
    `Nombre: ${input.businessName}`,
    `Rubro: ${input.businessType}`,
    `Descripción: ${input.description || '—'}`,
    `Hoy: ${input.todayLabel}`,
    '',
    'MARCA',
    input.brand,
    '',
    'SERVICIOS',
    input.services || '—',
    '',
    'HORARIOS',
    input.hours || '—',
    '',
    'CONTENIDO RECIENTE (no repetir el mismo ángulo)',
    input.recent || '—',
    '',
    'PEDIDO',
    `Objetivo: ${OBJECTIVE_LABEL[input.objective]} (${input.objective})`,
    `Formato: ${input.mediaType === 'VIDEO' ? `VIDEO ${input.durationSeconds}s 9:16` : 'IMAGEN'}`,
    `Canales: ${input.channels.join(', ') || '—'}`,
    `Servicio foco: ${
      input.selectedService
        ? `${input.selectedService.name}${
            input.selectedService.description
              ? ` — ${input.selectedService.description}`
              : ''
          }`
        : 'elegí el más potente para este objetivo'
    }`,
    input.hint?.trim()
      ? `Nota del usuario (respetala y estructurala): ${input.hint.trim()}`
      : 'El usuario no tiene idea: proponé vos el ángulo más fuerte.',
  ].join('\n');
}
