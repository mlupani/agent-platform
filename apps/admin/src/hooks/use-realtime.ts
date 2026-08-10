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

function resolveApiKey() {
  return (
    process.env.NEXT_PUBLIC_ADMIN_API_KEY ??
    process.env.ADMIN_API_KEY ??
    ''
  );
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
    const apiKey = resolveApiKey();
    if (!apiKey) return;
    if (socketRef.current?.connected) return;

    const socket = io(`${resolveWsUrl()}/realtime`, {
      transports: ['websocket', 'polling'],
      auth: { apiKey },
      query: { apiKey },
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1_000,
    });
    socketRef.current = socket;

    const invalidateConversations = () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const patchConversationMessage = (envelope: MessageCreatedEnvelope) => {
      const conversationId = envelope.payload?.conversationId;
      const message = envelope.payload?.message;
      if (!conversationId || !message?.id) {
        invalidateConversations();
        return;
      }

      // Actualización inmediata del chat abierto
      queryClient.setQueryData(
        ['conversation', conversationId],
        (current: Conversation | undefined) => {
          if (!current) return current;
          const messages = current.messages ?? [];
          if (messages.some((item) => item.id === message.id)) return current;
          if (
            message.externalId &&
            messages.some((item) => item.externalId === message.externalId)
          ) {
            return current;
          }
          return {
            ...current,
            messages: [...messages, message],
            lastMessageAt: message.createdAt ?? current.lastMessageAt,
            lastMessagePreview: message.content ?? current.lastMessagePreview,
            lastMessageSender: message.sender ?? current.lastMessageSender,
          };
        },
      );

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
                }
              : item,
          );
        },
      );

      // Revalidar en background por si faltan campos
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const patchConversationUpdated = (
      envelope: ConversationUpdatedEnvelope,
    ) => {
      const conversationId = envelope.payload?.conversationId;
      if (!conversationId) {
        invalidateConversations();
        return;
      }
      const patch = envelope.payload ?? {};
      queryClient.setQueryData(
        ['conversations'],
        (current: Conversation[] | undefined) => {
          if (!Array.isArray(current)) return current;
          return current.map((item) =>
            item.id === conversationId ? { ...item, ...patch } : item,
          );
        },
      );
      queryClient.setQueryData(
        ['conversation', conversationId],
        (current: Conversation | undefined) =>
          current ? { ...current, ...patch } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
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

    socket.on('connect', () => {
      invalidateConversations();
      invalidateWhatsapp();
    });

    socket.on('conversation.message.created', patchConversationMessage);
    socket.on('conversation.updated', patchConversationUpdated);
    socket.on('conversation.bot_status.changed', invalidateConversations);
    socket.on('message.status.updated', invalidateConversations);
    socket.on('whatsapp.status.changed', invalidateWhatsapp);
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
    socket.on('realtime.event', (envelope: { event?: string }) => {
      if (!envelope?.event) return;
      if (
        envelope.event.startsWith('conversation') ||
        envelope.event.startsWith('message')
      ) {
        invalidateConversations();
      }
      if (envelope.event.startsWith('whatsapp')) invalidateWhatsapp();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [queryClient]);
}
