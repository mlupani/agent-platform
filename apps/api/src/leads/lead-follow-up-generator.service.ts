import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { MemoryService } from '../ai/memory/memory.service';
import { LlmRoutingService } from '../ai/providers/llm-routing.service';
import { LeadLifecycleService } from './lead-lifecycle.service';

@Injectable()
export class LeadFollowUpGeneratorService {
  private readonly logger = new Logger(LeadFollowUpGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService,
    private readonly llm: LlmRoutingService,
    private readonly lifecycle: LeadLifecycleService,
  ) {}

  async generate(followUpId: string): Promise<string> {
    const followUp = await this.prisma.leadFollowUp.findUniqueOrThrow({
      where: { id: followUpId },
      include: {
        lead: { include: { conversation: true } },
      },
    });
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: followUp.businessId },
      include: {
        agentConfigs: { where: { isDefault: true }, take: 1 },
      },
    });
    const config = await this.lifecycle.getPublic(followUp.businessId);
    const conversation = followUp.lead.conversation;
    const recent = conversation
      ? await this.memory.getRecentMessages(conversation.id, followUp.businessId, 8)
      : [];
    const previous = await this.prisma.leadFollowUp.findMany({
      where: {
        leadId: followUp.leadId,
        status: 'sent',
        id: { not: followUp.id },
      },
      orderBy: { sentAt: 'desc' },
      take: 2,
      select: { sentMessage: true, objective: true },
    });

    const summary = conversation?.summary?.trim() || '';
    const transcript = recent
      .map((item) => `${item.role}: ${item.content}`)
      .join('\n');
    const prompt = [
      `Escribí un mensaje de seguimiento breve (máx 4 oraciones) en español rioplatense.`,
      `Negocio: ${business.name}. Tono: ${business.agentConfigs[0]?.tone ?? 'cálido y profesional'}.`,
      `Lead: ${followUp.lead.name || 'sin nombre'}. Estado: ${followUp.lead.status}.`,
      followUp.lead.interest ? `Interés: ${followUp.lead.interest}` : null,
      followUp.lead.objections ? `Objeciones: ${followUp.lead.objections}` : null,
      `Objetivo: ${followUp.objective}${followUp.objectiveNote ? ` (${followUp.objectiveNote})` : ''}.`,
      summary ? `Resumen de la conversación:\n${summary}` : null,
      transcript ? `Últimos mensajes:\n${transcript}` : null,
      previous[0]?.sentMessage
        ? `No repitas este mensaje anterior:\n${previous[0].sentMessage}`
        : null,
      `PROHIBIDO inventar que se reservó un turno/clase, fecha, hora, dirección o que está confirmado. Si no hay appointment real en el historial, no lo menciones. No inventes datos. Si el objetivo es retomar, solo preguntá si quiere avanzar.`,
      `No uses plantillas genéricas tipo "¿seguís interesado?". No inventes promociones ni precios.`,
      `Devolvé SOLO el texto del mensaje, sin comillas ni explicación.`,
    ]
      .filter(Boolean)
      .join('\n');

    if (!config.generateWithAi) {
      return this.fallbackMessage(followUp.lead.name, followUp.objective);
    }

    try {
      const target = this.llm.resolvePrimary({
        provider: business.agentConfigs[0]?.provider ?? 'openai',
        model: business.agentConfigs[0]?.model ?? 'gpt-4.1-mini',
      });
      const response = await target.provider.chat({
        model: target.model,
        temperature: 0.4,
        maxTokens: 280,
        messages: [
          {
            role: 'system',
            content: 'Sos copywriter de seguimiento comercial. Escribí mensajes cortos y humanos.',
          },
          { role: 'user', content: prompt },
        ],
      });
      const text = response.content?.trim();
      if (text) return text.slice(0, 1500);
    } catch (error) {
      this.logger.warn(
        `No se pudo generar follow-up ${followUpId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
    return this.fallbackMessage(followUp.lead.name, followUp.objective);
  }

  async maybeWriteSummary(conversationId: string, businessId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessId },
      select: { summary: true },
    });
    if (conversation?.summary?.trim()) return;
    const recent = await this.memory.getRecentMessages(conversationId, businessId, 12);
    if (recent.length < 3) return;
    try {
      const business = await this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        include: { agentConfigs: { where: { isDefault: true }, take: 1 } },
      });
      const target = this.llm.resolvePrimary({
        provider: business.agentConfigs[0]?.provider ?? 'openai',
        model: business.agentConfigs[0]?.model ?? 'gpt-4.1-mini',
      });
      const response = await target.provider.chat({
        model: target.model,
        temperature: 0.2,
        maxTokens: 180,
        messages: [
          {
            role: 'system',
            content:
              'Resumí la conversación en 4-6 líneas: interés, objeciones, último tema y próximo paso. Español.',
          },
          {
            role: 'user',
            content: recent.map((item) => `${item.role}: ${item.content}`).join('\n'),
          },
        ],
      });
      const summary = response.content?.trim();
      if (summary) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { summary: summary.slice(0, 2000) },
        });
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar summary ${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private fallbackMessage(name: string | null, objective: string) {
    const who = name?.trim() ? name.trim() : '';
    const hello = who ? `Hola ${who}` : 'Hola';
    if (objective === 'complete_contact_data') {
      return `${hello}, para seguir con la inscripción necesito un WhatsApp o email de contacto. ¿Me lo pasás?`;
    }
    if (objective === 'book_appointment') {
      return `${hello}, ¿querés que te reserve un horario? Decime qué día te viene bien.`;
    }
    return `${hello}, te escribo por lo que charlamos. ¿Seguimos con el próximo paso cuando te quede cómodo?`;
  }
}
