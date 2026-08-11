'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardPayload } from '@/lib/types';

function relativeTime(value?: string | null) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.max(1, Math.round(diff / 60_000));
  if (mins < 60) return `${mins} minuto${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

export function DashboardHome() {
  const { data: dashboard, error, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardPayload>('/admin/analytics/dashboard'),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const m = dashboard?.metrics;
  const photos = m?.contentPhotosMonth ?? 0;
  const videos = m?.contentVideosMonth ?? 0;
  const cards = [
    {
      label: 'Conversaciones',
      value: m?.conversationsWeek ?? 0,
      hint: 'Últimos 7 días',
      icon: '💬',
    },
    {
      label: 'Citas esta semana',
      value: m?.appointmentsWeek ?? 0,
      hint: 'Lunes a domingo',
      icon: '📅',
    },
    {
      label: 'Citas hoy',
      value: m?.appointmentsToday ?? 0,
      hint: 'Confirmadas / pendientes',
      icon: '🗓️',
    },
    {
      label: 'Bot en pausa',
      value: m?.handoffsOpen ?? 0,
      hint: 'Conversaciones con atención humana',
      icon: '⏸',
    },
    {
      label: 'Contenido generado',
      value: m?.contentGeneratedMonth ?? 0,
      hint: `Este mes · ${photos} foto${photos === 1 ? '' : 's'} · ${videos} video${videos === 1 ? '' : 's'}`,
      icon: '✨',
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted mt-1">
          Resumen de actividad reciente de tu negocio.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : null}

      {error ? (
        <div className="panel rounded-2xl p-5 text-rose text-sm">
          No se pudo leer la API.
          <pre className="mono mt-3 text-xs text-muted whitespace-pre-wrap">
            {(error as Error).message}
          </pre>
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <article key={card.label} className="panel rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
                  {card.label}
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-tight">
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-muted">{card.hint}</p>
              </div>
              <span className="text-lg opacity-70" aria-hidden>
                {card.icon}
              </span>
            </div>
          </article>
        ))}
      </section>

      <section className="panel rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">Últimas conversaciones</h3>
          <Link
            href="/conversations"
            className="text-sm text-accent hover:underline"
          >
            Ver todas →
          </Link>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {(dashboard?.recentConversations ?? []).map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/conversations?c=${conversation.id}`}
                className="flex items-center justify-between gap-4 py-3 hover:bg-panel-2 -mx-2 px-2 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {conversation.contactName ||
                      conversation.contactPhone ||
                      'Sin nombre'}
                  </p>
                  <p className="text-xs text-muted truncate mt-0.5">
                    {conversation.lastMessagePreview || 'Sin mensajes'}
                  </p>
                </div>
                <span className="text-xs text-muted shrink-0">
                  {relativeTime(conversation.lastMessageAt)}
                </span>
              </Link>
            </li>
          ))}
          {!dashboard?.recentConversations?.length && !isLoading ? (
            <li className="py-6 text-sm text-muted">
              Todavía no hay conversaciones.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
