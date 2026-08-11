import { Injectable } from '@nestjs/common';
import {
  REALTIME_EVENTS,
  type RealtimeEnvelope,
  type RealtimeEventName,
} from './realtime.types';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RealtimeEventsService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emit<T>(
    event: RealtimeEventName | string,
    payload: T,
    businessId?: string,
  ) {
    const envelope: RealtimeEnvelope<T> = {
      event,
      businessId,
      payload,
      at: new Date().toISOString(),
    };
    this.gateway.broadcast(envelope);
  }

  conversationMessageCreated(
    businessId: string,
    payload: Record<string, unknown>,
  ) {
    this.emit(REALTIME_EVENTS.CONVERSATION_MESSAGE_CREATED, payload, businessId);
  }

  conversationUpdated(businessId: string, payload: Record<string, unknown>) {
    this.emit(REALTIME_EVENTS.CONVERSATION_UPDATED, payload, businessId);
  }

  conversationBotStatusChanged(
    businessId: string,
    payload: Record<string, unknown>,
  ) {
    this.emit(
      REALTIME_EVENTS.CONVERSATION_BOT_STATUS_CHANGED,
      payload,
      businessId,
    );
  }

  whatsappStatusChanged(
    businessId: string,
    payload: Record<string, unknown> | object,
  ) {
    this.emit(
      REALTIME_EVENTS.WHATSAPP_STATUS_CHANGED,
      payload as Record<string, unknown>,
      businessId,
    );
  }

  whatsappQrUpdated(
    businessId: string,
    payload: Record<string, unknown> | object,
  ) {
    this.emit(
      REALTIME_EVENTS.WHATSAPP_QR_UPDATED,
      payload as Record<string, unknown>,
      businessId,
    );
  }

  instagramStatusChanged(
    businessId: string,
    payload: Record<string, unknown> | object,
  ) {
    this.emit(
      REALTIME_EVENTS.INSTAGRAM_STATUS_CHANGED,
      payload as Record<string, unknown>,
      businessId,
    );
  }

  messageStatusUpdated(businessId: string, payload: Record<string, unknown>) {
    this.emit(REALTIME_EVENTS.MESSAGE_STATUS_UPDATED, payload, businessId);
  }
}
