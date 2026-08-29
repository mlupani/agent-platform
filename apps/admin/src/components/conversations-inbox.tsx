'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import {
  ChannelBadge,
  FacebookIcon,
  InstagramIconMono,
  WhatsAppIcon,
} from '@/components/channel-icons';
import type { Conversation, Message } from '@/lib/types';

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function senderLabel(sender?: string, role?: string) {
  if (sender === 'CLIENT' || role === 'user') return 'Contacto';
  if (sender === 'HUMAN') return 'Vos';
  if (sender === 'AI' || role === 'assistant') return 'Asistente';
  if (sender === 'TOOL' || role === 'tool') return 'Sistema';
  return role ?? 'Mensaje';
}

function ContactAvatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-xs';
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={`${dim} rounded-full object-cover shrink-0 bg-panel-2`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-full bg-accent text-white flex items-center justify-center font-semibold shrink-0`}
    >
      {initials(name)}
    </div>
  );
}

function activityTs(conversation: Conversation): number {
  const value = conversation.lastMessageAt;
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function matchesSearch(conversation: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const haystack = [
    conversation.displayName,
    conversation.contactName,
    conversation.contactUsername,
    conversation.contactPhone,
    conversation.user?.name,
    conversation.user?.phone,
    conversation.externalId,
    conversation.channel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack.includes(q)) return true;
  if (digits.length >= 3) {
    const phoneHay = [
      conversation.contactPhone,
      conversation.user?.phone,
      conversation.externalId,
    ]
      .filter(Boolean)
      .join('')
      .replace(/\D/g, '');
    return phoneHay.includes(digits);
  }
  return false;
}

type InboxChannelFilter = {
  whatsapp: boolean;
  instagram: boolean;
  facebook: boolean;
};

function matchesChannel(
  conversation: Conversation,
  channels: InboxChannelFilter,
): boolean {
  const ch = (conversation.channel ?? '').toUpperCase();
  if (ch === 'WHATSAPP') return channels.whatsapp;
  if (ch === 'INSTAGRAM') return channels.instagram;
  if (ch === 'FACEBOOK') return channels.facebook;
  return channels.whatsapp || channels.instagram || channels.facebook;
}

function ChannelFilterOrb({
  channel,
  selected,
  onToggle,
}: {
  channel: 'whatsapp' | 'instagram' | 'facebook';
  selected: boolean;
  onToggle: () => void;
}) {
  const meta = {
    whatsapp: {
      label: 'WhatsApp',
      selectedClass:
        'bg-[#25D366] text-white shadow-[0_0_0_3px_rgba(37,211,102,0.28)]',
      icon: <WhatsAppIcon className="h-4 w-4" title="WhatsApp" />,
    },
    instagram: {
      label: 'Instagram',
      selectedClass:
        'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white shadow-[0_0_0_3px_rgba(221,42,123,0.28)]',
      icon: <InstagramIconMono className="h-4 w-4" title="Instagram" />,
    },
    facebook: {
      label: 'Messenger',
      selectedClass:
        'bg-[#1877F2] text-white shadow-[0_0_0_3px_rgba(24,119,242,0.28)]',
      icon: <FacebookIcon className="h-4 w-4" title="Messenger" />,
    },
  }[channel];
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Filtrar ${meta.label}`}
      title={
        selected
          ? `${meta.label} visible. Tocá para ocultar.`
          : `${meta.label} oculto. Tocá para mostrar.`
      }
      onClick={onToggle}
      className={`h-9 w-9 rounded-full grid place-items-center shrink-0 transition duration-200 ${
        selected ? meta.selectedClass : 'bg-line/80 text-muted hover:bg-line'
      }`}
    >
      {meta.icon}
    </button>
  );
}

function mergeMessages(
  incoming: Message[] | undefined,
  cached: Message[] | undefined,
): Message[] {
  const list = [...(incoming ?? [])];
  const seen = new Set<string>();
  for (const msg of list) {
    if (msg.id) seen.add(msg.id);
    if (msg.externalId) seen.add(msg.externalId);
  }
  for (const msg of cached ?? []) {
    if (!msg?.id) continue;
    if (seen.has(msg.id)) continue;
    if (msg.externalId && seen.has(msg.externalId)) continue;
    list.push(msg);
    seen.add(msg.id);
    if (msg.externalId) seen.add(msg.externalId);
  }
  return list.sort((a, b) => {
    const ta = new Date(a.createdAt ?? 0).getTime();
    const tb = new Date(b.createdAt ?? 0).getTime();
    return ta - tb;
  });
}

export function ConversationsInbox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('c');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [channels, setChannels] = useState<InboxChannelFilter>({
    whatsapp: true,
    instagram: true,
    facebook: true,
  });
  const [filter, setFilter] = useState<'all' | 'attention' | 'ai' | 'closed'>(
    'all',
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  const listPullRef = useRef(true);

  useEffect(() => {
    const enablePull = () => {
      listPullRef.current = true;
    };
    window.addEventListener('focus', enablePull);
    return () => window.removeEventListener('focus', enablePull);
  }, []);

  const listQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => {
      const pull = listPullRef.current;
      listPullRef.current = false;
      return api<Conversation[]>(
        pull ? '/admin/conversations' : '/admin/conversations?sync=0',
      );
    },
    refetchInterval: 20_000,
  });

  const detailQuery = useQuery({
    queryKey: ['conversation', selectedId],
    queryFn: async () => {
      const data = await api<Conversation>(
        `/admin/conversations/${selectedId}`,
      );
      const cached = queryClient.getQueryData<Conversation>([
        'conversation',
        selectedId,
      ]);
      if (!cached?.messages?.length) return data;
      return {
        ...data,
        messages: mergeMessages(data.messages, cached.messages),
      };
    },
    enabled: Boolean(selectedId),
    refetchInterval: (query) => {
      const data = query.state.data as Conversation | undefined;
      if (data?.channel !== 'INSTAGRAM' && data?.channel !== 'FACEBOOK') {
        return false;
      }
      if (data.inboxSync === 'webhook') return false;
      return 8_000;
    },
  });

  const conversations = useMemo(() => {
    const items = [...(listQuery.data ?? [])]
      .filter((item) => {
        if (filter === 'attention') return Boolean(item.needsAttention);
        if (filter === 'ai') return item.status === 'AI';
        if (filter === 'closed') return item.status === 'CLOSED';
        // "Todas": activas (cerradas van al filtro Cerradas)
        return item.status !== 'CLOSED';
      })
      .filter((item) => matchesSearch(item, search))
      .filter((item) => matchesChannel(item, channels))
      .sort((a, b) => activityTs(b) - activityTs(a));
    return items;
  }, [listQuery.data, filter, search, channels]);

  const selected = detailQuery.data;
  const listedSelected = useMemo(
    () => (listQuery.data ?? []).find((item) => item.id === selectedId),
    [listQuery.data, selectedId],
  );
  const catchupAtRef = useRef(0);
  const showChat = Boolean(selectedId);
  const visibleMessages = useMemo(
    () =>
      (selected?.messages ?? []).filter((message) => message.role !== 'tool'),
    [selected?.messages],
  );

  useEffect(() => {
    catchupAtRef.current = 0;
  }, [selectedId]);

  // Si la lista ya muestra un mensaje más nuevo que el hilo abierto, recargar el chat.
  useEffect(() => {
    if (!selectedId || !listedSelected || detailQuery.isFetching) return;
    const listTs = new Date(listedSelected.lastMessageAt ?? 0).getTime();
    const lastMsg = selected?.messages?.at(-1);
    const chatTs = new Date(
      lastMsg?.createdAt ?? selected?.lastMessageAt ?? 0,
    ).getTime();
    if (!Number.isFinite(listTs) || listTs <= chatTs + 1_500) return;
    const now = Date.now();
    if (now - catchupAtRef.current < 4_000) return;
    catchupAtRef.current = now;
    void queryClient.invalidateQueries({
      queryKey: ['conversation', selectedId],
    });
  }, [
    selectedId,
    listedSelected,
    listedSelected?.lastMessageAt,
    listedSelected?.lastMessagePreview,
    selected?.lastMessageAt,
    selected?.messages,
    detailQuery.isFetching,
    queryClient,
  ]);

  // Marcar leído al abrir / cuando llegan mensajes con el chat abierto
  useEffect(() => {
    if (!selectedId || detailQuery.isLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        await api<{ unreadCount: number }>(
          `/admin/conversations/${selectedId}/read`,
          { method: 'POST' },
        );
        if (cancelled) return;
        queryClient.setQueryData(
          ['conversations'],
          (current: Conversation[] | undefined) => {
            if (!Array.isArray(current)) return current;
            return current.map((item) =>
              item.id === selectedId ? { ...item, unreadCount: 0 } : item,
            );
          },
        );
        queryClient.setQueryData(
          ['conversation', selectedId],
          (current: Conversation | undefined) =>
            current ? { ...current, unreadCount: 0 } : current,
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedId,
    detailQuery.isLoading,
    visibleMessages.length,
    queryClient,
  ]);

  useEffect(() => {
    if (!selectedId || detailQuery.isLoading) return;
    const frame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      const scroller = messagesScrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, detailQuery.isLoading, visibleMessages.length, selected?.id]);

  function openConversation(id: string) {
    router.push(`/conversations?c=${id}`);
  }

  function backToList() {
    router.push('/conversations');
  }

  const pauseMutation = useMutation({
    mutationFn: () =>
      api(`/admin/conversations/${selectedId}/pause`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['conversation', selectedId],
      });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      api(`/admin/conversations/${selectedId}/resume`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['conversation', selectedId],
      });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      api(`/admin/conversations/${selectedId}/close`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['conversation', selectedId],
      });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api(`/admin/conversations/${selectedId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      const removedId = selectedId;
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (removedId) {
        queryClient.removeQueries({ queryKey: ['conversation', removedId] });
      }
      router.push('/conversations');
    },
  });

  const replyMutation = useMutation({
    mutationFn: (content: string) =>
      api(`/admin/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({
        queryKey: ['conversation', selectedId],
      });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Conversaciones
          </h2>
          <p className="text-sm text-muted mt-1">
            Atendé chats, pausá el bot y respondé manualmente.
          </p>
        </div>
        <div className="flex gap-2 text-xs overflow-x-auto pb-1 -mx-1 px-1 max-w-full">
          {(
            [
              ['all', 'Todas'],
              ['attention', 'Requieren atención'],
              ['ai', 'Bot activo'],
              ['closed', 'Cerradas'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded-full px-3 py-2.5 min-h-10 border ${
                filter === value
                  ? 'border-nav-active bg-nav-active text-white'
                  : 'border-line text-muted bg-panel'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="panel overflow-hidden rounded-2xl h-[calc(100dvh-11rem)] min-h-0 md:min-h-[520px] grid md:grid-cols-[minmax(280px,340px)_1fr]">
        <aside
          className={`border-r border-line flex flex-col min-h-0 ${
            showChat ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="p-3 border-b border-line shrink-0">
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="chat-search">
                Buscar chats
              </label>
              <input
                id="chat-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre o número…"
                className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <ChannelFilterOrb
                  channel="facebook"
                  selected={channels.facebook}
                  onToggle={() =>
                    setChannels((current) => {
                      const next = {
                        ...current,
                        facebook: !current.facebook,
                      };
                      if (!next.whatsapp && !next.instagram && !next.facebook) {
                        return current;
                      }
                      return next;
                    })
                  }
                />
                <ChannelFilterOrb
                  channel="instagram"
                  selected={channels.instagram}
                  onToggle={() =>
                    setChannels((current) => {
                      const next = {
                        ...current,
                        instagram: !current.instagram,
                      };
                      if (!next.whatsapp && !next.instagram && !next.facebook) {
                        return current;
                      }
                      return next;
                    })
                  }
                />
                <ChannelFilterOrb
                  channel="whatsapp"
                  selected={channels.whatsapp}
                  onToggle={() =>
                    setChannels((current) => {
                      const next = {
                        ...current,
                        whatsapp: !current.whatsapp,
                      };
                      if (!next.whatsapp && !next.instagram && !next.facebook) {
                        return current;
                      }
                      return next;
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {listQuery.isLoading ? (
              <p className="p-4 text-sm text-muted">Cargando…</p>
            ) : null}
            {listQuery.error ? (
              <p className="p-4 text-sm text-rose">
                {(listQuery.error as Error).message}
              </p>
            ) : null}
            {!conversations.length && !listQuery.isLoading ? (
              <p className="p-4 text-sm text-muted">
                {search.trim()
                  ? 'No hay chats que coincidan con la búsqueda.'
                  : !channels.whatsapp ||
                      !channels.instagram ||
                      !channels.facebook
                    ? 'No hay chats en los canales seleccionados.'
                    : 'Todavía no hay conversaciones.'}
              </p>
            ) : null}
            <ul>
              {conversations.map((conversation) => {
                const active = conversation.id === selectedId;
                const name =
                  conversation.displayName ?? conversation.id.slice(0, 8);
                const unread = conversation.unreadCount ?? 0;
                const hasUnread = !active && unread > 0;
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(conversation.id)}
                      className={`w-full text-left px-4 py-3 border-b border-line transition ${
                        active ? 'bg-accent-soft' : 'hover:bg-panel-2'
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className="relative shrink-0">
                          <ContactAvatar
                            name={name}
                            src={conversation.contactAvatarUrl}
                          />
                          {hasUnread ? (
                            <span
                              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-panel"
                              aria-hidden
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={`text-sm truncate flex items-center gap-1.5 min-w-0 ${
                                hasUnread ? 'font-semibold text-text' : 'font-medium'
                              }`}
                            >
                              <ChannelBadge channel={conversation.channel} />
                              <span className="truncate">{name}</span>
                            </p>
                            <span
                              className={`text-[11px] shrink-0 ${
                                hasUnread
                                  ? 'text-accent font-medium'
                                  : 'text-muted'
                              }`}
                            >
                              {formatTime(
                                conversation.lastMessageAt ??
                                  conversation.updatedAt,
                              )}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <p
                              className={`text-xs truncate ${
                                hasUnread
                                  ? 'text-text font-medium'
                                  : 'text-muted'
                              }`}
                            >
                              {conversation.lastMessagePreview ||
                                'Sin mensajes'}
                            </p>
                            <div className="flex items-center gap-1 shrink-0">
                              {conversation.botActive ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full badge-success">
                                  Bot
                                </span>
                              ) : conversation.status !== 'CLOSED' ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full badge-warn">
                                  Manual
                                </span>
                              ) : null}
                              {hasUnread ? (
                                <span
                                  className="inline-flex min-w-[1.25rem] h-5 items-center justify-center rounded-full bg-red-600 text-white text-[11px] font-semibold px-1.5"
                                  aria-label={`${unread} sin leer`}
                                >
                                  {unread > 99 ? '99+' : unread}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section
          className={`flex flex-col min-h-0 min-w-0 bg-panel-2/40 ${
            showChat ? 'flex' : 'hidden md:flex'
          }`}
        >
          {!selectedId ? (
            <div className="flex-1 grid place-items-center text-sm text-muted p-6">
              Seleccioná una conversación para ver el chat.
            </div>
          ) : detailQuery.isLoading ? (
            <div className="flex-1 grid place-items-center text-sm text-muted">
              Cargando chat…
            </div>
          ) : selected ? (
            <div className="flex flex-1 min-h-0 w-full max-w-3xl mx-auto flex-col bg-panel border-x border-line/60 shadow-sm">
              <div className="border-b border-line px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    className="md:hidden inline-flex items-center min-h-10 px-2 -ml-2 text-sm text-accent"
                    onClick={backToList}
                  >
                    ← Volver
                  </button>
                  <ContactAvatar
                    name={selected.displayName ?? selected.id.slice(0, 8)}
                    src={selected.contactAvatarUrl}
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate flex items-center gap-2">
                      <ChannelBadge channel={selected.channel} />
                      <span className="truncate">
                        {selected.displayName ?? selected.id.slice(0, 8)}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      {selected.contactUsername
                        ? `@${selected.contactUsername.replace(/^@/, '')}`
                        : selected.contactPhone ||
                          selected.user?.phone ||
                          selected.channel}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted">Bot activo</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={selected.status === 'AI'}
                      className={`relative h-6 w-11 rounded-full transition ${
                        selected.status === 'AI' ? 'bg-accent' : 'bg-line'
                      }`}
                      onClick={() => {
                        if (selected.status === 'AI') pauseMutation.mutate();
                        else if (selected.status !== 'CLOSED')
                          resumeMutation.mutate();
                      }}
                      disabled={
                        selected.status === 'CLOSED' ||
                        pauseMutation.isPending ||
                        resumeMutation.isPending
                      }
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                          selected.status === 'AI' ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </label>
                  {selected.status !== 'CLOSED' ? (
                    <button
                      type="button"
                      className="rounded-lg border border-line px-3 py-2.5 text-sm text-muted min-h-10"
                      onClick={() => closeMutation.mutate()}
                      disabled={closeMutation.isPending || deleteMutation.isPending}
                    >
                      Cerrar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-2.5 text-sm text-rose min-h-10"
                    onClick={() => {
                      if (
                        confirm(
                          '¿Eliminar esta conversación de la bandeja? No se mostrará más salvo que el contacto escriba de nuevo.',
                        )
                      ) {
                        deleteMutation.mutate();
                      }
                    }}
                    disabled={deleteMutation.isPending || closeMutation.isPending}
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {selected.needsAttention ? (
                <div className="px-4 py-2 bg-amber/10 text-amber text-xs border-b border-line">
                  Requiere atención
                  {selected.metadata &&
                  typeof selected.metadata === 'object' &&
                  'handoffReason' in selected.metadata
                    ? ` — ${String((selected.metadata as { handoffReason?: string }).handoffReason)}`
                    : ''}
                </div>
              ) : null}

              <div
                ref={messagesScrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-panel-2/50"
              >
                {visibleMessages.map((message: Message) => {
                  const fromOther =
                    message.sender === 'CLIENT' || message.role === 'user';
                  return (
                    <article
                      key={message.id}
                      className={`w-fit max-w-[min(20rem,72%)] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        fromOther
                          ? 'bg-[#e5e7eb] text-[#1f2937] mr-auto'
                          : 'bg-[#0066ff] text-white ml-auto'
                      }`}
                    >
                      <p
                        className={`text-[10px] mb-1 ${
                          fromOther ? 'text-[#6b7280]' : 'text-white/75'
                        }`}
                      >
                        {senderLabel(message.sender, message.role)} ·{' '}
                        {formatTime(message.createdAt)}
                      </p>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </article>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <form
                className="border-t border-line p-3 flex gap-2 bg-panel safe-pad-b"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draft.trim() || selected.status === 'CLOSED') return;
                  replyMutation.mutate(draft.trim());
                }}
              >
                <input
                  className="flex-1 min-w-0 rounded-xl bg-panel border border-line px-3 py-3 text-sm min-h-11"
                  placeholder={
                    selected.status === 'CLOSED'
                      ? 'Conversación cerrada'
                      : 'Escribí una respuesta manual…'
                  }
                  value={draft}
                  disabled={
                    selected.status === 'CLOSED' || replyMutation.isPending
                  }
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={
                    selected.status === 'CLOSED' ||
                    !draft.trim() ||
                    replyMutation.isPending
                  }
                  className="shrink-0 rounded-xl bg-[#0066ff] px-4 py-3 text-sm text-white disabled:opacity-50 min-h-11"
                >
                  Enviar
                </button>
              </form>
              {replyMutation.error ? (
                <p className="px-3 pb-3 text-xs text-rose">
                  {(replyMutation.error as Error).message}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-rose p-6">
              No se encontró la conversación.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
