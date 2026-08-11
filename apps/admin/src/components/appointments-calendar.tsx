'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

interface CalendarFeedItem {
  id: string;
  source: 'local' | 'google';
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  googleEventId: string | null;
  htmlLink: string | null;
  canCancel: boolean;
  service: { id: string; name: string; durationMinutes?: number } | null;
}

interface CalendarFeed {
  googleConnected: boolean;
  items: CalendarFeedItem[];
}

const WEEKDAY = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayKeyFromIso(value: string, allDay: boolean) {
  if (allDay && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return toIsoDate(new Date(value));
}

function buildMonthCells(month: Date) {
  const first = startOfMonth(month);
  const jsDay = first.getDay();
  const mondayIndex = jsDay === 0 ? 6 : jsDay - 1;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayIndex);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function formatWhen(item: CalendarFeedItem) {
  if (item.allDay) {
    return `Todo el día · ${dayKeyFromIso(item.startsAt, true)}`;
  }
  return `${new Date(item.startsAt).toLocaleString('es-AR')} — ${new Date(
    item.endsAt,
  ).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function AppointmentsCalendar() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<CalendarFeedItem | null>(null);

  const range = useMemo(() => {
    const cells = buildMonthCells(month);
    const from = new Date(cells[0]);
    from.setHours(0, 0, 0, 0);
    const to = new Date(cells[41]);
    to.setHours(23, 59, 59, 999);
    return { from, to, cells };
  }, [month]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'appointments-calendar',
      toIsoDate(range.from),
      toIsoDate(range.to),
    ],
    queryFn: () =>
      api<CalendarFeed>(
        `/admin/appointments/feed?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      ),
  });

  const items = data?.items ?? [];
  const googleConnected = data?.googleConnected ?? false;

  const remove = useMutation({
    mutationFn: (item: CalendarFeedItem) =>
      api('/admin/appointments/feed-item', {
        method: 'DELETE',
        body: JSON.stringify({
          source: item.source,
          id: item.source === 'google' ? item.id : item.id,
        }),
      }),
    onSuccess: async () => {
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['appointments-calendar'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarFeedItem[]>();
    for (const cell of range.cells) map.set(toIsoDate(cell), []);
    for (const item of items) {
      const key = dayKeyFromIso(item.startsAt, item.allDay);
      const list = map.get(key);
      if (!list) continue;
      list.push(item);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
    }
    return map;
  }, [items, range.cells]);

  const todayKey = toIsoDate(new Date());
  const monthIndex = month.getMonth();
  const year = month.getFullYear();

  useEffect(() => {
    if (!selected) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div className="space-y-5 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight">
            {MONTHS[monthIndex]} {year}
          </h3>
          <p className="text-sm text-muted mt-1">
            {googleConnected
              ? 'Citas del negocio + eventos de Google Calendar'
              : 'Solo citas locales (conectá Google en Integraciones)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mes anterior"
            className="h-9 w-9 rounded-lg border border-line bg-panel text-lg leading-none text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => setMonth((prev) => addMonths(prev, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="rounded-lg border border-line bg-panel px-3.5 py-2 text-sm text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => setMonth(startOfMonth(new Date()))}
          >
            Hoy
          </button>
          <button
            type="button"
            aria-label="Mes siguiente"
            className="h-9 w-9 rounded-lg border border-line bg-panel text-lg leading-none text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => setMonth((prev) => addMonths(prev, 1))}
          >
            ›
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      {/* Vista agenda (móvil) */}
      <div className="md:hidden rounded-xl border border-line bg-panel overflow-hidden divide-y divide-line">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">Cargando calendario…</p>
        ) : (
          range.cells
            .filter((day) => day.getMonth() === monthIndex)
            .map((day) => {
              const key = toIsoDate(day);
              const isToday = key === todayKey;
              const dayItems = byDay.get(key) ?? [];
              return (
                <div key={key} className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                        isToday
                          ? 'bg-accent text-white font-medium'
                          : 'bg-panel-2 text-text'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <p className="text-sm font-medium capitalize">
                      {day.toLocaleDateString('es-AR', { weekday: 'long' })}
                    </p>
                    {!dayItems.length ? (
                      <span className="text-xs text-muted ml-auto">Sin eventos</span>
                    ) : null}
                  </div>
                  {dayItems.length ? (
                    <ul className="space-y-1.5 pl-10">
                      {dayItems.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(item)}
                            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm min-h-11 ${
                              item.source === 'google'
                                ? 'bg-accent-soft text-accent'
                                : 'bg-success-soft text-success'
                            }`}
                          >
                            {!item.allDay ? (
                              <span className="opacity-80 mr-1.5">
                                {new Date(item.startsAt).toLocaleTimeString(
                                  'es-AR',
                                  { hour: '2-digit', minute: '2-digit' },
                                )}
                              </span>
                            ) : null}
                            {item.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })
        )}
      </div>

      {/* Vista grilla (desktop) — estilo limpio a ancho completo */}
      <div className="hidden md:block w-full">
        <div className="grid grid-cols-7 gap-2 mb-2">
          {WEEKDAY.map((label) => (
            <div
              key={label}
              className="text-center text-sm font-medium text-muted py-1"
            >
              {label}
            </div>
          ))}
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-muted">Cargando calendario…</p>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {range.cells.map((day) => {
              const key = toIsoDate(day);
              const inMonth = day.getMonth() === monthIndex;
              const isToday = key === todayKey;
              const dayItems = byDay.get(key) ?? [];

              return (
                <div
                  key={key}
                  className="aspect-square overflow-hidden rounded-lg border border-line bg-panel p-2 flex flex-col"
                >
                  <div className="flex justify-start shrink-0">
                    <span
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-sm ${
                        isToday
                          ? 'bg-accent text-white font-medium px-1'
                          : inMonth
                            ? 'text-text font-medium'
                            : 'text-muted'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <ul className="space-y-1 min-h-0 overflow-hidden mt-1.5">
                    {dayItems.slice(0, 3).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(item)}
                          className={`w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight truncate ${
                            item.source === 'google'
                              ? 'bg-accent-soft text-accent'
                              : 'bg-success-soft text-success'
                          }`}
                          title={item.title}
                        >
                          {!item.allDay ? (
                            <span className="opacity-80 mr-1">
                              {new Date(item.startsAt).toLocaleTimeString(
                                'es-AR',
                                { hour: '2-digit', minute: '2-digit' },
                              )}
                            </span>
                          ) : null}
                          {item.title}
                        </button>
                      </li>
                    ))}
                    {dayItems.length > 3 ? (
                      <li className="text-[10px] text-muted px-1">
                        +{dayItems.length - 3} más
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-success-soft border border-success/30" />
          Cita del agente
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent-soft border border-accent/30" />
          Evento Google
        </span>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar"
            onClick={() => setSelected(null)}
          />
          <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto safe-pad-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted">
                  {selected.source === 'google'
                    ? 'Google Calendar'
                    : 'Cita local'}
                </p>
                <h3
                  id="event-modal-title"
                  className="font-semibold text-lg mt-1"
                >
                  {selected.title}
                </h3>
                <p className="text-sm text-muted mt-1">{formatWhen(selected)}</p>
              </div>
              <button
                type="button"
                className="text-muted hover:text-text text-xl leading-none px-1"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>

            {selected.contactPhone ? (
              <p className="text-sm">Tel: {selected.contactPhone}</p>
            ) : null}
            {selected.contactEmail ? (
              <p className="text-sm">Email: {selected.contactEmail}</p>
            ) : null}
            {selected.notes ? (
              <p className="text-sm text-muted whitespace-pre-wrap">
                {selected.notes}
              </p>
            ) : null}
            {selected.htmlLink ? (
              <a
                href={selected.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-accent hover:underline inline-block"
              >
                Abrir en Google Calendar →
              </a>
            ) : null}

            {remove.error ? (
              <p className="text-sm text-rose">
                {(remove.error as Error).message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="rounded-lg border border-rose/30 text-rose px-4 py-2 text-sm hover:bg-rose/5 disabled:opacity-60"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    confirm(
                      selected.source === 'google'
                        ? '¿Borrar este evento de Google Calendar?'
                        : '¿Cancelar / borrar esta cita?',
                    )
                  ) {
                    remove.mutate(selected);
                  }
                }}
              >
                {remove.isPending ? 'Borrando…' : 'Borrar evento'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-panel-2"
                onClick={() => setSelected(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
