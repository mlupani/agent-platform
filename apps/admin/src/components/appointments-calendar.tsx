'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  ClassRosterView,
  type ClassSession,
} from '@/components/class-roster-view';
import { PersonSheet, type PersonTarget } from '@/components/person-sheet';
import { ReplicateWeekDialog } from '@/components/replicate-week-dialog';

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
  userId?: string | null;
  isTrial?: boolean | null;
}

interface CalendarFeed {
  googleConnected: boolean;
  items: CalendarFeedItem[];
}

type CalendarView = 'month' | 'week' | 'day';

const VIEW_STORAGE_KEY = 'calendar-view';
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
const VIEWS: { id: CalendarView; label: string }[] = [
  { id: 'month', label: 'Mes' },
  { id: 'week', label: 'Semana' },
  { id: 'day', label: 'Día' },
];
const HOUR_PX = 52;

function isCalendarView(value: string | null): value is CalendarView {
  return value === 'month' || value === 'week' || value === 'day';
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = startOfDay(date);
  const jsDay = day.getDay();
  const mondayIndex = jsDay === 0 ? 6 : jsDay - 1;
  day.setDate(day.getDate() - mondayIndex);
  return day;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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

function daysForView(view: CalendarView, cursor: Date) {
  if (view === 'month') return buildMonthCells(cursor);
  if (view === 'week') {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return [startOfDay(cursor)];
}

function shiftCursor(cursor: Date, view: CalendarView, direction: -1 | 1) {
  if (view === 'month') return addMonths(startOfMonth(cursor), direction);
  if (view === 'week') return addDays(cursor, direction * 7);
  return addDays(cursor, direction);
}

function headingFor(view: CalendarView, cursor: Date) {
  if (view === 'month') {
    return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }
  if (view === 'day') {
    return cursor.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}-${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()]} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

function navLabel(view: CalendarView, direction: 'prev' | 'next') {
  const unit = view === 'month' ? 'mes' : view === 'week' ? 'semana' : 'día';
  return direction === 'prev' ? `${unit} anterior` : `${unit} siguiente`;
}

function formatWhen(item: CalendarFeedItem) {
  if (item.allDay) {
    return `Todo el día · ${dayKeyFromIso(item.startsAt, true)}`;
  }
  return `${new Date(item.startsAt).toLocaleString('es-AR')} — ${new Date(
    item.endsAt,
  ).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function eventClass(source: CalendarFeedItem['source']) {
  return source === 'google'
    ? 'bg-accent-soft text-accent'
    : 'bg-success-soft text-success';
}

function visibleHourRange(items: CalendarFeedItem[], days: Date[]) {
  let start = 8;
  let end = 21;
  const minT = startOfDay(days[0]).getTime();
  const maxT = addDays(startOfDay(days[days.length - 1]), 1).getTime();
  for (const item of items) {
    if (item.allDay) continue;
    const s = new Date(item.startsAt).getTime();
    const e = new Date(item.endsAt).getTime();
    if (e <= minT || s >= maxT) continue;
    start = Math.min(start, new Date(item.startsAt).getHours());
    const endDate = new Date(item.endsAt);
    end = Math.max(
      end,
      endDate.getHours() + (endDate.getMinutes() > 0 ? 1 : 0),
    );
  }
  return {
    start: Math.max(0, start),
    end: Math.min(24, Math.max(end, start + 1)),
  };
}

function eventOffset(
  item: CalendarFeedItem,
  day: Date,
  hourStart: number,
  hourEnd: number,
) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const start = Math.max(new Date(item.startsAt).getTime(), dayStart);
  const end = Math.min(new Date(item.endsAt).getTime(), dayEnd);
  if (end <= start) return null;
  const startMin = (start - dayStart) / 60000;
  const endMin = Math.max(end - dayStart, start + 20 * 60000 - dayStart) / 60000;
  const top = (startMin / 60 - hourStart) * HOUR_PX;
  const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 22);
  const maxTop = (hourEnd - hourStart) * HOUR_PX;
  if (top >= maxTop || top + height <= 0) return null;
  return {
    top: Math.max(0, top),
    height: Math.min(height, maxTop - Math.max(0, top)),
  };
}

export function AppointmentsCalendar() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<CalendarView>('month');
  const [viewReady, setViewReady] = useState(false);
  const [selected, setSelected] = useState<CalendarFeedItem | null>(null);
  const [person, setPerson] = useState<PersonTarget | null>(null);
  const [replicateOpen, setReplicateOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (isCalendarView(stored)) setView(stored);
    setViewReady(true);
  }, []);

  useEffect(() => {
    if (!viewReady) return;
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view, viewReady]);

  const days = useMemo(() => daysForView(view, cursor), [view, cursor]);

  const range = useMemo(() => {
    const from = startOfDay(days[0]);
    const to = addDays(startOfDay(days[days.length - 1]), 1);
    to.setMilliseconds(-1);
    return { from, to };
  }, [days]);

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

  const classesQuery = useQuery({
    queryKey: [
      'appointment-classes',
      toIsoDate(range.from),
      toIsoDate(range.to),
    ],
    queryFn: () =>
      api<{ timezone: string; sessions: ClassSession[] }>(
        `/admin/appointments/classes?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      ),
  });

  const sessions = classesQuery.data?.sessions ?? [];

  const visibleDays = useMemo(() => {
    if (view !== 'week') return days;
    const sunday = days[6];
    if (!sunday) return days;
    const key = toIsoDate(sunday);
    const hasSunday = sessions.some((session) => session.date === key);
    return hasSunday ? days : days.slice(0, 6);
  }, [days, view, sessions]);

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
      await queryClient.invalidateQueries({ queryKey: ['appointment-classes'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const byDay = useMemo(() => {
    const items = data?.items ?? [];
    const map = new Map<string, CalendarFeedItem[]>();
    for (const day of days) map.set(toIsoDate(day), []);
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
  }, [data?.items, days]);

  const todayKey = toIsoDate(new Date());
  const monthIndex = cursor.getMonth();

  useEffect(() => {
    if (!selected) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  function goToDay(day: Date) {
    setCursor(startOfDay(day));
    setView('day');
  }

  return (
    <div className="space-y-5 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight capitalize">
            {headingFor(view, cursor)}
          </h3>
          <p className="text-sm text-muted mt-1">
            {googleConnected
              ? 'Citas del negocio + eventos de Google Calendar'
              : 'Solo citas locales (conectá Google en Integraciones)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex rounded-lg border border-line bg-panel p-0.5"
            role="radiogroup"
            aria-label="Vista del calendario"
          >
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={view === item.id}
                className={`min-h-9 px-3 text-sm rounded-md transition ${
                  view === item.id
                    ? 'bg-accent text-white font-medium'
                    : 'text-muted hover:text-text hover:bg-panel-2'
                }`}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={navLabel(view, 'prev')}
            className="h-9 w-9 rounded-lg border border-line bg-panel text-lg leading-none text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => setCursor((prev) => shiftCursor(prev, view, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="rounded-lg border border-line bg-panel px-3.5 py-2 text-sm text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => setCursor(startOfDay(new Date()))}
          >
            Hoy
          </button>
          <button
            type="button"
            aria-label={navLabel(view, 'next')}
            className="h-9 w-9 rounded-lg border border-line bg-panel text-lg leading-none text-muted hover:bg-panel-2 hover:text-text"
            onClick={() => setCursor((prev) => shiftCursor(prev, view, 1))}
          >
            ›
          </button>
          {view !== 'month' ? (
            <button
              type="button"
              className="min-h-9 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-text hover:bg-panel-2"
              onClick={() => setReplicateOpen(true)}
              title="Copiar las alumnas de esta semana a otra semana"
            >
              Duplicar semana
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      {view === 'month' ? (
        <MonthView
          days={days}
          byDay={byDay}
          sessions={sessions}
          todayKey={todayKey}
          monthIndex={monthIndex}
          isLoading={isLoading || classesQuery.isLoading}
          onSelect={setSelected}
          onOpenDay={goToDay}
        />
      ) : (
        <ClassRosterView
          days={visibleDays}
          sessions={sessions}
          googleItems={(data?.items ?? []).filter((item) => item.source === 'google')}
          todayKey={todayKey}
          isLoading={isLoading || classesQuery.isLoading}
          onSelect={setSelected}
          onOpenDay={view === 'week' ? goToDay : undefined}
          onOpenPerson={setPerson}
        />
      )}

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
        <EventModal
          selected={selected}
          removing={remove.isPending}
          error={remove.error as Error | null}
          onClose={() => setSelected(null)}
          onOpenPerson={(t) => {
            setSelected(null);
            setPerson(t);
          }}
          onRemove={() => {
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
        />
      ) : null}
      <PersonSheet target={person} open={!!person} onClose={() => setPerson(null)} />
      <ReplicateWeekDialog
        open={replicateOpen}
        onClose={() => setReplicateOpen(false)}
        sourceFrom={range.from.toISOString()}
        sourceTo={range.to.toISOString()}
        viewLabel={view === 'day' ? 'día' : 'semana'}
      />
    </div>
  );
}

function EventChip({
  item,
  dense,
  onSelect,
}: {
  item: CalendarFeedItem;
  dense?: boolean;
  onSelect: (item: CalendarFeedItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left rounded-md truncate ${eventClass(item.source)} ${
        dense
          ? 'px-1.5 py-1 text-[11px] leading-tight'
          : 'px-2 py-1.5 text-xs leading-tight'
      }`}
      title={item.title}
    >
      {!item.allDay ? (
        <span className="opacity-80 mr-1">
          {new Date(item.startsAt).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ) : null}
      {item.title}
    </button>
  );
}

function MonthView({
  days,
  byDay,
  sessions,
  todayKey,
  monthIndex,
  isLoading,
  onSelect,
  onOpenDay,
}: {
  days: Date[];
  byDay: Map<string, CalendarFeedItem[]>;
  sessions: ClassSession[];
  todayKey: string;
  monthIndex: number;
  isLoading: boolean;
  onSelect: (item: CalendarFeedItem) => void;
  onOpenDay: (day: Date) => void;
}) {
  return (
    <>
      <div className="md:hidden rounded-xl border border-line bg-panel overflow-hidden divide-y divide-line">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">Cargando calendario…</p>
        ) : (
          days
            .filter((day) => day.getMonth() === monthIndex)
            .map((day) => {
              const key = toIsoDate(day);
              const isToday = key === todayKey;
              const daySessions = sessions.filter((session) => session.date === key);
              const googleItems = (byDay.get(key) ?? []).filter(
                (item) => item.source === 'google',
              );
              return (
                <div key={key} className="p-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className="flex items-center gap-2 w-full text-left"
                  >
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
                    {!daySessions.length && !googleItems.length ? (
                      <span className="text-xs text-muted ml-auto">Sin clases</span>
                    ) : null}
                  </button>
                  {daySessions.length || googleItems.length ? (
                    <ul className="space-y-1.5 pl-10">
                      {daySessions.map((session) => (
                        <li key={session.id}>
                          <button
                            type="button"
                            onClick={() => onOpenDay(day)}
                            className="w-full text-left rounded-lg px-3 py-2.5 text-sm min-h-11 bg-success-soft text-success"
                          >
                            <span className="tabular-nums opacity-80 mr-1.5">
                              {session.start}
                            </span>
                            {session.service?.name ?? 'Clase'} {session.booked}/
                            {session.capacity}
                          </button>
                        </li>
                      ))}
                      {googleItems.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(item)}
                            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm min-h-11 ${eventClass(item.source)}`}
                          >
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
            {days.map((day) => {
              const key = toIsoDate(day);
              const inMonth = day.getMonth() === monthIndex;
              const isToday = key === todayKey;
              const daySessions = sessions.filter((session) => session.date === key);
              const googleItems = (byDay.get(key) ?? []).filter(
                (item) => item.source === 'google',
              );
              const chips = [
                ...daySessions.map((session) => ({
                  id: session.id,
                  label: `${session.start} ${session.service?.name ?? 'Clase'} ${session.booked}/${session.capacity}`,
                  kind: 'class' as const,
                })),
                ...googleItems.map((item) => ({
                  id: item.id,
                  label: item.title,
                  kind: 'google' as const,
                  item,
                })),
              ];

              return (
                <div
                  key={key}
                  className="aspect-square overflow-hidden rounded-lg border border-line bg-panel p-2 flex flex-col"
                >
                  <div className="flex justify-start shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-sm ${
                        isToday
                          ? 'bg-accent text-white font-medium px-1'
                          : inMonth
                            ? 'text-text font-medium hover:bg-panel-2'
                            : 'text-muted hover:bg-panel-2'
                      }`}
                      aria-label={`Ver ${day.toLocaleDateString('es-AR')}`}
                    >
                      {day.getDate()}
                    </button>
                  </div>
                  <ul className="space-y-1 min-h-0 overflow-hidden mt-1.5">
                    {chips.slice(0, 3).map((chip) => (
                      <li key={chip.id}>
                        <button
                          type="button"
                          className={`w-full text-left rounded-md truncate px-1.5 py-1 text-[11px] leading-tight ${
                            chip.kind === 'google'
                              ? 'bg-accent-soft text-accent'
                              : 'bg-success-soft text-success'
                          }`}
                          title={chip.label}
                          onClick={() => {
                            if (chip.kind === 'google' && 'item' in chip && chip.item) {
                              onSelect(chip.item);
                              return;
                            }
                            onOpenDay(day);
                          }}
                        >
                          {chip.label}
                        </button>
                      </li>
                    ))}
                    {chips.length > 3 ? (
                      <li>
                        <button
                          type="button"
                          className="text-[10px] text-muted px-1 hover:text-text"
                          onClick={() => onOpenDay(day)}
                        >
                          +{chips.length - 3} más
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function TimeGridView({
  days,
  byDay,
  todayKey,
  hours,
  isLoading,
  compact,
  onSelect,
  onOpenDay,
}: {
  days: Date[];
  byDay: Map<string, CalendarFeedItem[]>;
  todayKey: string;
  hours: { start: number; end: number };
  isLoading: boolean;
  compact: boolean;
  onSelect: (item: CalendarFeedItem) => void;
  onOpenDay?: (day: Date) => void;
}) {
  const hourCount = hours.end - hours.start;
  const hourLabels = Array.from({ length: hourCount }, (_, i) => hours.start + i);
  const hasAllDay = days.some((day) =>
    (byDay.get(toIsoDate(day)) ?? []).some((item) => item.allDay),
  );

  if (isLoading) {
    return <p className="p-6 text-sm text-muted">Cargando calendario…</p>;
  }

  return (
    <div className="rounded-xl border border-line bg-panel overflow-hidden">
      <div className="overflow-x-auto">
        <div
          className="min-w-160"
          style={{
            display: 'grid',
            gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="border-b border-line" />
          {days.map((day) => {
            const key = toIsoDate(day);
            const isToday = key === todayKey;
            const inner = (
              <div
                className={`px-2 py-2.5 text-center border-b border-l border-line ${
                  isToday ? 'bg-accent-soft/40' : ''
                }`}
              >
                <p className="text-[11px] uppercase tracking-wide text-muted">
                  {day.toLocaleDateString('es-AR', { weekday: 'short' })}
                </p>
                <p
                  className={`mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full text-sm font-medium ${
                    isToday ? 'bg-accent text-white' : 'text-text'
                  }`}
                >
                  {day.getDate()}
                </p>
              </div>
            );
            return onOpenDay ? (
              <button
                key={key}
                type="button"
                className="text-left hover:bg-panel-2"
                onClick={() => onOpenDay(day)}
                aria-label={`Ver ${day.toLocaleDateString('es-AR')}`}
              >
                {inner}
              </button>
            ) : (
              <div key={key}>{inner}</div>
            );
          })}

          {hasAllDay ? (
            <>
              <div className="px-1 py-2 text-[10px] text-muted border-b border-line flex items-end">
                Día
              </div>
              {days.map((day) => {
                const allDayItems = (byDay.get(toIsoDate(day)) ?? []).filter(
                  (item) => item.allDay,
                );
                return (
                  <div
                    key={`all-${toIsoDate(day)}`}
                    className="border-b border-l border-line p-1 space-y-1 min-h-10"
                  >
                    {allDayItems.map((item) => (
                      <EventChip
                        key={item.id}
                        item={item}
                        dense={compact}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          ) : null}

          <div className="relative">
            {hourLabels.map((hour) => (
              <div
                key={hour}
                className="border-b border-line text-[10px] text-muted pr-2 text-right"
                style={{ height: HOUR_PX }}
              >
                <span className="relative -top-2">{formatHour(hour)}</span>
              </div>
            ))}
          </div>
          {days.map((day) => {
            const key = toIsoDate(day);
            const timed = (byDay.get(key) ?? []).filter((item) => !item.allDay);
            const isToday = key === todayKey;
            return (
              <div
                key={`grid-${key}`}
                className={`relative border-l border-line ${isToday ? 'bg-accent-soft/20' : ''}`}
                style={{ height: hourCount * HOUR_PX }}
              >
                {hourLabels.map((hour) => (
                  <div
                    key={hour}
                    className="border-b border-line/70"
                    style={{ height: HOUR_PX }}
                  />
                ))}
                {timed.map((item) => {
                  const box = eventOffset(item, day, hours.start, hours.end);
                  if (!box) return null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item)}
                      title={item.title}
                      className={`absolute left-1 right-1 rounded-md px-1.5 py-1 text-left overflow-hidden ${eventClass(item.source)} ${
                        compact ? 'text-[11px] leading-tight' : 'text-xs'
                      }`}
                      style={{ top: box.top, height: box.height }}
                    >
                      <span className="opacity-80 mr-1">
                        {new Date(item.startsAt).toLocaleTimeString('es-AR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {item.title}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventModal({
  selected,
  removing,
  error,
  onClose,
  onOpenPerson,
  onRemove,
}: {
  selected: CalendarFeedItem;
  removing: boolean;
  error: Error | null;
  onClose: () => void;
  onOpenPerson: (t: PersonTarget) => void;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const hasIdentity = Boolean(selected.userId || selected.contactPhone || selected.contactEmail);
  const isLocal = selected.source === 'local';
  const isPast = !selected.allDay && new Date(selected.endsAt).getTime() <= Date.now();
  const isCompleted = selected.status === 'completed';
  const isNoShow = selected.status === 'no_show';
  const attendance = useMutation({
    mutationFn: ({ id, attended }: { id: string; attended: boolean }) =>
      api(`/admin/appointments/${id}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({ attended }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appointments-calendar'] });
      await queryClient.invalidateQueries({ queryKey: ['appointment-classes'] });
      onClose();
    },
  });
  return (
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
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto safe-pad-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">
              {selected.source === 'google' ? 'Google Calendar' : 'Cita local'}
            </p>
            <h3 id="event-modal-title" className="font-semibold text-lg mt-1">
              {selected.title}
            </h3>
            <p className="text-sm text-muted mt-1">{formatWhen(selected)}</p>
          </div>
          <button
            type="button"
            className="text-muted hover:text-text text-xl leading-none px-1"
            onClick={onClose}
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
          <p className="text-sm text-muted whitespace-pre-wrap">{selected.notes}</p>
        ) : null}
        {hasIdentity ? (
          <div className="flex flex-wrap gap-2 py-2 border-y border-line/50">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs font-medium hover:bg-panel"
              onClick={() =>
                onOpenPerson({
                  userId: selected.userId,
                  contactName: selected.contactName,
                  contactPhone: selected.contactPhone,
                  contactEmail: selected.contactEmail,
                })
              }
            >
              Ver ficha
            </button>
            {selected.userId && (
              <span className="text-xs text-muted inline-flex items-center px-1 py-1" title={selected.userId}>
                ID: {selected.userId.slice(0, 8)}…
              </span>
            )}
          </div>
        ) : null}
        {isLocal && selected.status !== 'cancelled' ? (
          <div
            className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
              isCompleted
                ? 'border-emerald-200 bg-emerald-50'
                : isNoShow
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-line bg-panel-2/40'
            }`}
          >
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Asistencia</p>
              <p
                className={`text-sm font-medium ${isCompleted ? 'text-emerald-700' : isNoShow ? 'text-rose-700' : 'text-text'}`}
              >
                {isCompleted
                  ? '✓ Asistió — clase descontada'
                  : isNoShow
                    ? '✕ Faltó — clase devuelta al pack'
                    : isPast
                      ? 'Pendiente de confirmar'
                      : 'Anotada — se marcará al pasar la clase'}
              </p>
            </div>
            {isPast ? (
              <div className="flex gap-2 shrink-0">
                {!isCompleted ? (
                  <button
                    type="button"
                    disabled={attendance.isPending}
                    onClick={() => attendance.mutate({ id: selected.id, attended: true })}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Asistió
                  </button>
                ) : null}
                {!isNoShow ? (
                  <button
                    type="button"
                    disabled={attendance.isPending}
                    onClick={() => attendance.mutate({ id: selected.id, attended: false })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white text-rose-700 px-3 py-1.5 text-xs font-medium hover:bg-rose-50 disabled:opacity-50"
                  >
                    Faltó
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {attendance.isError ? (
          <p className="text-sm text-rose">{(attendance.error as Error).message}</p>
        ) : null}
        {attendance.isSuccess ? <p className="text-sm text-emerald-700">Asistencia actualizada.</p> : null}
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

        {error ? <p className="text-sm text-rose">{error.message}</p> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="rounded-lg border border-rose/30 text-rose px-4 py-2 text-sm hover:bg-rose/5 disabled:opacity-60"
            disabled={removing}
            onClick={onRemove}
          >
            {removing ? 'Borrando…' : 'Borrar evento'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-panel-2"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
