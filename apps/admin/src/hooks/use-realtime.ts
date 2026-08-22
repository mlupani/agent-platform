'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { Conversation, Message } from '@/lib/types';

function resolveWsUrl() {
  const api =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.API_URL ??
    'http://localhost:3001/api';
  return api.replace(/\/api\/?$/, '');
}

interface MessageCreatedEnvelope {
  event?: string;
  payload?: {
    conversationId?: string;
    message?: Message | null;
  };
}

interface ConversationUpdatedEnvelope {
  event?: string;
  payload?: {
    conversationId?: string;
    status?: string;
    lastMessageAt?: string;
    lastMessagePreview?: string;
    lastMessageSender?: string;
    unreadCount?: number;
  };
}

/** Suscripción global: un solo socket para todo el admin. */
export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (socketRef.current?.connected) return;

    const socket = io(`${resolveWsUrl()}/realtime`, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1_000,
    });
    socketRef.current = socket;

    const invalidateConversationList = () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const patchConversationMessage = (envelope: MessageCreatedEnvelope) => {
      const conversationId = envelope.payload?.conversationId;
      const message = envelope.payload?.message;
      if (!conversationId || !message?.id) {
        invalidateConversationList();
        return;
      }

      const detail = queryClient.getQueryData<Conversation>([
        'conversation',
        conversationId,
      ]);
      const messages = detail?.messages ?? [];
      const alreadyInThread =
        messages.some((item) => item.id === message.id) ||
        Boolean(
          message.externalId &&
            messages.some((item) => item.externalId === message.externalId),
        );

      queryClient.setQueryData(
        ['conversation', conversationId],
        (current: Conversation | undefined) => {
          if (!current || alreadyInThread) return current;
          return {
            ...current,
            messages: [...(current.messages ?? []), message],
            lastMessageAt: message.createdAt ?? current.lastMessageAt,
            lastMessagePreview: message.content ?? current.lastMessagePreview,
            lastMessageSender: message.sender ?? current.lastMessageSender,
          };
        },
      );

      const isClientInbound =
        message.sender === 'CLIENT' || message.role === 'user';

      queryClient.setQueryData(
        ['conversations'],
        (current: Conversation[] | undefined) => {
          if (!Array.isArray(current)) return current;
          return current.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  lastMessageAt: message.createdAt ?? item.lastMessageAt,
                  lastMessagePreview:
                    message.content ?? item.lastMessagePreview,
                  lastMessageSender:
                    message.sender ?? item.lastMessageSender,
                  unreadCount:
                    isClientInbound && !alreadyInThread
                      ? (item.unreadCount ?? 0) + 1
                      : item.unreadCount,
                }
              : item,
          );
        },
      );

      invalidateConversationList();
    };

    const patchConversationUpdated = (
      envelope: ConversationUpdatedEnvelope,
    ) => {
      const conversationId = envelope.payload?.conversationId;
      if (!conversationId) {
        invalidateConversationList();
        return;
      }
      const patch = envelope.payload ?? {};
      queryClient.setQueryData(
        ['conversations'],
        (current: Conversation[] | undefined) => {
          if (!Array.isArray(current)) return current;
          return current.map((item) => {
            if (item.id !== conversationId) return item;
            const next = { ...item, ...patch };
            if (typeof patch.unreadCount !== 'number') {
              next.unreadCount = item.unreadCount;
            }
            return next;
          });
        },
      );
      queryClient.setQueryData(
        ['conversation', conversationId],
        (current: Conversation | undefined) =>
          current ? { ...current, ...patch } : current,
      );
      invalidateConversationList();
    };

    const invalidateWhatsapp = () => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
    };

    const invalidateCalendar = () => {
      void queryClient.invalidateQueries({
        queryKey: ['appointments-calendar'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['google-calendar-config'],
      });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const invalidateContent = () => {
      void queryClient.invalidateQueries({ queryKey: ['content-list'] });
      void queryClient.invalidateQueries({ queryKey: ['content-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['content'] });
    };

    socket.on('connect', () => {
      invalidateConversationList();
      invalidateWhatsapp();
    });

    socket.on('conversation.message.created', patchConversationMessage);
    socket.on('conversation.updated', patchConversationUpdated);
    socket.on('conversation.bot_status.changed', invalidateConversationList);
    socket.on('conversation.inbox.cleared', () => {
      void queryClient.removeQueries({ queryKey: ['conversation'] });
      invalidateConversationList();
    });
    socket.on('message.status.updated', invalidateConversationList);
    socket.on('whatsapp.status.changed', () => {
      invalidateWhatsapp();
      invalidateConversationList();
    });
    socket.on('instagram.status.changed', invalidateConversationList);
    socket.on(
      'whatsapp.qr.updated',
      (envelope: { payload?: { qrDataUrl?: string } }) => {
        void queryClient.setQueryData(
          ['whatsapp-config'],
          (current: unknown) => {
            if (!current || typeof current !== 'object') return current;
            return {
              ...(current as object),
              qrDataUrl: envelope?.payload?.qrDataUrl,
              status: 'scan_qr',
              lastError: null,
            };
          },
        );
      },
    );
    socket.on('appointment.updated', invalidateCalendar);
    socket.on('content.generation.started', invalidateContent);
    socket.on('content.generation.completed', invalidateContent);
    socket.on('content.generation.failed', invalidateContent);
    socket.on('content.publishing', invalidateContent);
    socket.on('content.published', invalidateContent);
    socket.on('content.updated', invalidateContent);
    socket.on('realtime.event', (envelope: { event?: string }) => {
      if (!envelope?.event) return;
      if (envelope.event.startsWith('whatsapp')) invalidateWhatsapp();
      if (envelope.event.startsWith('content')) invalidateContent();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [queryClient]);
}
