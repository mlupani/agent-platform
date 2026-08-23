'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardPayload } from '@/lib/types';
import { ChannelBadge } from '@/components/channel-icons';

type DailyPoint = DashboardPayload['daily'][number];
type ChannelStat = DashboardPayload['channels'][number];

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'Chat web',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Messenger',
};

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

function channelLabel(channel?: string | null) {
  if (!channel) return 'Sin datos';
  return CHANNEL_LABEL[channel.toUpperCase()] ?? channel;
}

function deltaCopy(delta: number | null | undefined) {
  if (delta == null) return 'Sin base el mes anterior';
  if (delta > 0) return `+${delta}% vs mes anterior`;
  if (delta < 0) return `${delta}% vs mes anterior`;
  return 'Igual que el mes anterior';
}

function deltaClass(delta: number | null | undefined) {
  if (delta == null) return 'text-muted';
  if (delta > 0) return 'text-success';
  if (delta < 0) return 'text-rose';
  return 'text-muted';
}

export function DashboardHome() {
  const [month, setMonth] = useState('');
  const { data: dashboard, error, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard', month || 'current'],
    queryFn: () =>
      api<DashboardPayload>(
        `/admin/analytics/dashboard${month ? `?month=${encodeURIComponent(month)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const m = dashboard?.metrics;
  const selectedMonth = month || dashboard?.period.month || '';
  const monthOptions = dashboard?.period.availableMonths ?? [];
  const channels = dashboard?.channels ?? [];
  const daily = dashboard?.daily ?? [];
  const topChannel = m?.topChannel ?? null;
  const photos = m?.contentPhotosMonth ?? 0;
  const videos = m?.contentVideosMonth ?? 0;
  const hasMonthActivity =
    (m?.leadsMonth ?? 0) + (m?.newClientsMonth ?? 0) + (m?.conversationsMonth ?? 0) > 0;

  const topChannelLeads =
    channels.find((row) => row.channel === topChannel)?.leads ?? 0;
  const kpis = [
    {
      label: 'Leads',
      value: m?.leadsMonth ?? 0,
      hint: deltaCopy(m?.leadsMonthDelta),
      tone: deltaClass(m?.leadsMonthDelta),
      href: '/leads',
    },
    {
      label: 'Alumnos nuevos',
      value: m?.newClientsMonth ?? 0,
      hint: deltaCopy(m?.newClientsMonthDelta),
      tone: deltaClass(m?.newClientsMonthDelta),
      href: '/clientes',
    },
    {
      label: 'Conversaciones',
      value: m?.conversationsMonth ?? 0,
      hint: deltaCopy(m?.conversationsMonthDelta),
      tone: deltaClass(m?.conversationsMonthDelta),
      href: '/conversations',
    },
    {
      label: 'Canal más efectivo',
      value: channelLabel(topChannel),
      hint: topChannel
        ? `${topChannelLeads} ${topChannelLeads === 1 ? 'lead' : 'leads'} este mes`
        : 'Todavía no hay leads en el mes',
      tone: 'text-muted',
      href: '/conversations',
      channel: topChannel,
    },
  ];

  return (
    <div className="space-y-7 max-w-6xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted mt-1">
            {dashboard
              ? `Panorama de ${dashboard.period.monthLabel} · ${dashboard.business.name}`
              : 'Resumen de leads, alumnos y canales de tu negocio.'}
          </p>
        </div>
        <label className="flex flex-col gap-1.5 min-w-[13.5rem]">
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
            Mes
          </span>
          <select
            className="input"
            value={selectedMonth}
            onChange={(event) => setMonth(event.target.value)}
            disabled={!monthOptions.length}
            aria-label="Seleccionar mes"
          >
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <div className="panel rounded-2xl p-5 text-rose text-sm">
          No se pudo leer la API.
          <pre className="mono mt-3 text-xs text-muted whitespace-pre-wrap">
            {(error as Error).message}
          </pre>
        </div>
      ) : null}

      {isLoading && !dashboard ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="panel rounded-2xl p-5 hover:border-accent/40 transition-colors"
              >
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
                  {card.label}
                </p>
                <div className="mt-3 flex items-center gap-2.5 min-h-10">
                  {'channel' in card && card.channel ? (
                    <ChannelBadge channel={card.channel} size="md" />
                  ) : null}
                  <p className="text-3xl font-semibold tracking-tight truncate">
                    {card.value}
                  </p>
                </div>
                <p className={`mt-2 text-xs ${card.tone}`}>{card.hint}</p>
              </Link>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <article className="panel rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">Crecimiento diario</h3>
                  <p className="text-xs text-muted mt-1">
                    Leads, alumnos nuevos y conversaciones de{' '}
                    {dashboard?.period.monthLabel?.toLowerCase() ?? 'este mes'}.
                  </p>
                </div>
                {isFetching && dashboard ? (
                  <span className="text-[11px] text-muted">Actualizando</span>
                ) : null}
              </div>
              {hasMonthActivity ? (
                <MonthlyTrendChart daily={daily} today={dashboard?.period.today} />
              ) : (
                <p className="mt-8 mb-4 text-sm text-muted">
                  Este mes todavía no hay movimiento para graficar.
                </p>
              )}
            </article>

            <article className="panel rounded-2xl p-5">
              <h3 className="font-medium">Canal más efectivo</h3>
              <p className="text-xs text-muted mt-1">
                Comparamos leads captados en web, Instagram y WhatsApp.
              </p>
              <ChannelEffectiveness channels={channels} topChannel={topChannel} />
            </article>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_0.72fr]">
            <article className="panel rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">Últimas conversaciones</h3>
                <Link
                  href="/conversations"
                  className="text-sm text-accent hover:underline"
                >
                  Ver todas
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {(dashboard?.recentConversations ?? []).map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/conversations?c=${conversation.id}`}
                      className="flex items-center justify-between gap-4 py-3 hover:bg-panel-2 -mx-2 px-2 rounded-lg"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ChannelBadge channel={conversation.channel} />
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
                      </div>
                      <span className="text-xs text-muted shrink-0">
                        {relativeTime(conversation.lastMessageAt)}
                      </span>
                    </Link>
                  </li>
                ))}
                {!dashboard?.recentConversations?.length ? (
                  <li className="py-6 text-sm text-muted">
                    Todavía no hay conversaciones.
                  </li>
                ) : null}
              </ul>
            </article>

            <article className="panel rounded-2xl p-5">
              <h3 className="font-medium">Operación de hoy</h3>
              <p className="text-xs text-muted mt-1">
                Independiente del mes seleccionado.
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-3">
                <StatChip
                  label="Citas hoy"
                  value={m?.appointmentsToday ?? 0}
                  href="/calendar"
                />
                <StatChip
                  label="Citas semana"
                  value={m?.appointmentsWeek ?? 0}
                  href="/calendar"
                />
                <StatChip
                  label="Bot en pausa"
                  value={m?.handoffsOpen ?? 0}
                  href="/conversations"
                />
                <StatChip
                  label="Sin leer"
                  value={m?.unreadMessages ?? 0}
                  href="/conversations"
                />
              </dl>
              <p className="mt-5 text-xs text-muted">
                Contenido generado este mes: {m?.contentGeneratedMonth ?? 0}
                {photos || videos
                  ? ` · ${photos} foto${photos === 1 ? '' : 's'} · ${videos} video${videos === 1 ? '' : 's'}`
                  : ''}
                .
              </p>
            </article>
          </section>
        </>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl bg-panel-2 px-3.5 py-3 hover:bg-accent-soft transition-colors"
    >
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
    </Link>
  );
}

function ChannelEffectiveness({
  channels,
  topChannel,
}: {
  channels: ChannelStat[];
  topChannel: string | null;
}) {
  const maxLeads = Math.max(1, ...channels.map((row) => row.leads));
  if (!channels.some((row) => row.conversations > 0 || row.leads > 0)) {
    return (
      <p className="mt-8 text-sm text-muted">
        Todavía no hay contactos de web, Instagram o WhatsApp este mes.
      </p>
    );
  }

  return (
    <ul className="mt-5 space-y-4">
      {channels.map((row) => {
        const width = Math.max(6, Math.round((row.leads / maxLeads) * 100));
        const isTop = row.channel === topChannel && row.leads > 0;
        return (
          <li key={row.channel}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ChannelBadge channel={row.channel} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {channelLabel(row.channel)}
                    {isTop ? (
                      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-teal">
                        Mejor
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted">
                    {row.leads} {row.leads === 1 ? 'lead' : 'leads'} · {row.conversations}{' '}
                    {row.conversations === 1 ? 'conversación' : 'conversaciones'}
                  </p>
                </div>
              </div>
              <span className="text-sm font-medium shrink-0">{row.share}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-panel-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${isTop ? 'bg-teal' : 'bg-accent'}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              {row.conversations > 0
                ? `${row.conversion}% de las conversaciones terminaron en lead`
                : row.leads > 0
                  ? 'Lead de un contacto iniciado en otro mes'
                  : 'Sin conversaciones este mes'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function MonthlyTrendChart({
  daily,
  today,
}: {
  daily: DailyPoint[];
  today?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 220;
  const pad = { top: 18, right: 12, bottom: 28, left: 28 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxY = Math.max(
    1,
    ...daily.flatMap((point) => [point.leads, point.clients, point.conversations]),
  );

  const series = useMemo(() => {
    const xFor = (index: number) =>
      pad.left + (daily.length <= 1 ? innerW / 2 : (index / (daily.length - 1)) * innerW);
    const yFor = (value: number) => pad.top + innerH - (value / maxY) * innerH;
    const toPoints = (key: keyof Omit<DailyPoint, 'date'>) =>
      daily.map((point, index) => `${xFor(index)},${yFor(point[key])}`).join(' ');
    const area = `${pad.left},${pad.top + innerH} ${toPoints('conversations')} ${
      pad.left + innerW
    },${pad.top + innerH}`;
    return { xFor, yFor, toPoints, area };
  }, [daily, innerH, innerW, maxY, pad.left, pad.top]);

  const ticks = [0, Math.round(maxY / 2), maxY];
  const dayTicks = daily.filter((_, index) => {
    if (daily.length <= 10) return true;
    return index === 0 || index === daily.length - 1 || (index + 1) % 5 === 0;
  });
  const active = hover !== null ? daily[hover] : null;
  const futureIndex = today ? daily.findIndex((point) => point.date > today) : -1;
  const futureX = futureIndex >= 0 ? series.xFor(futureIndex) : null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted mb-2">
        <LegendSwatch className="bg-accent" label="Leads" />
        <LegendSwatch className="bg-teal" label="Alumnos nuevos" />
        <LegendSwatch className="bg-line" label="Conversaciones" />
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[220px]"
        role="img"
        aria-label="Gráfico diario de leads, alumnos y conversaciones"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={series.yFor(tick)}
              y2={series.yFor(tick)}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <text
              x={pad.left - 6}
              y={series.yFor(tick) + 3}
              textAnchor="end"
              className="fill-muted"
              fontSize="10"
            >
              {tick}
            </text>
          </g>
        ))}
        <polygon points={series.area} fill="var(--accent)" opacity="0.08" />
        {futureX !== null ? (
          <rect
            x={futureX}
            y={pad.top}
            width={Math.max(0, width - pad.right - futureX)}
            height={innerH}
            fill="var(--panel-2)"
            opacity="0.55"
          />
        ) : null}
        <polyline
          points={series.toPoints('conversations')}
          fill="none"
          stroke="var(--line)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={series.toPoints('clients')}
          fill="none"
          stroke="var(--teal)"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={series.toPoints('leads')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {daily.map((point, index) => {
          const x = series.xFor(index);
          return (
            <rect
              key={point.date}
              x={x - innerW / daily.length / 2}
              y={pad.top}
              width={Math.max(8, innerW / daily.length)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            >
              <title>
                {point.date}: {point.leads} leads, {point.clients} alumnos,{' '}
                {point.conversations} conversaciones
              </title>
            </rect>
          );
        })}
        {active && hover !== null ? (
          <g>
            <line
              x1={series.xFor(hover)}
              x2={series.xFor(hover)}
              y1={pad.top}
              y2={pad.top + innerH}
              stroke="var(--text)"
              strokeOpacity="0.18"
            />
            <circle cx={series.xFor(hover)} cy={series.yFor(active.leads)} r="3.5" fill="var(--accent)" />
            <circle cx={series.xFor(hover)} cy={series.yFor(active.clients)} r="3.5" fill="var(--teal)" />
          </g>
        ) : null}
        {dayTicks.map((point) => (
          <text
            key={point.date}
            x={series.xFor(daily.indexOf(point))}
            y={height - 8}
            textAnchor="middle"
            className="fill-muted"
            fontSize="10"
          >
            {Number(point.date.slice(-2))}
          </text>
        ))}
      </svg>
      {active ? (
        <p className="text-xs text-muted mt-1">
          Día {Number(active.date.slice(-2))}: {active.leads} lead
          {active.leads === 1 ? '' : 's'}, {active.clients} alumno
          {active.clients === 1 ? '' : 's'}, {active.conversations}{' '}
          {active.conversations === 1 ? 'conversación' : 'conversaciones'}.
        </p>
      ) : (
        <p className="text-xs text-muted mt-1">
          Pasá el cursor sobre el gráfico para ver cada día.
        </p>
      )}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-3.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="panel rounded-2xl h-32 animate-pulse bg-panel-2" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="panel rounded-2xl h-72 animate-pulse bg-panel-2" />
        <div className="panel rounded-2xl h-72 animate-pulse bg-panel-2" />
      </div>
    </div>
  );
}
