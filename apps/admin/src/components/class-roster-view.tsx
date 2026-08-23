'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ClientRow } from '@/lib/types';

export interface ClassAttendee {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  userId: string | null;
  status: string;
  notes: string | null;
}

export interface ClassSession {
  id: string;
  date: string;
  start: string;
  startsAt: string;
  endsAt: string;
  dayOfWeek: number;
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    capacity: number;
  } | null;
  capacity: number;
  booked: number;
  remaining: number;
  templateId: string | null;
  attendees: ClassAttendee[];
}

export interface CalendarFeedItem {
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

function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function clientLabel(client: ClientRow) {
  return client.name || client.phone || client.email || 'Sin nombre';
}

function formatApiError(error: unknown) {
  const raw = error instanceof Error ? error.message : 'No se pudo anotar.';
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    return parsed.message || raw;
  } catch {
    return raw;
  }
}

export function attendeeToItem(
  session: ClassSession,
  attendee: ClassAttendee,
): CalendarFeedItem {
  return {
    id: attendee.id,
    source: 'local',
    title: session.service
      ? `${session.service.name} · ${attendee.contactName || 'Alumna'}`
      : attendee.contactName || 'Cita',
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    allDay: false,
    status: attendee.status,
    contactName: attendee.contactName,
    contactPhone: attendee.contactPhone,
    contactEmail: attendee.contactEmail,
    notes: attendee.notes,
    googleEventId: null,
    htmlLink: null,
    canCancel: true,
    service: session.service,
  };
}

export function ClassRosterView({
  days,
  sessions,
  googleItems,
  todayKey,
  isLoading,
  onSelect,
  onOpenDay,
}: {
  days: Date[];
  sessions: ClassSession[];
  googleItems: CalendarFeedItem[];
  todayKey: string;
  isLoading: boolean;
  onSelect: (item: CalendarFeedItem) => void;
  onOpenDay?: (day: Date) => void;
}) {
  const [adding, setAdding] = useState<ClassSession | null>(null);
  const [editingCapacity, setEditingCapacity] = useState<ClassSession | null>(null);
  const byDay = useMemo(() => {
    const map = new Map<string, ClassSession[]>();
    for (const day of days) map.set(toIsoDate(day), []);
    for (const session of sessions) {
      const list = map.get(session.date);
      if (!list) continue;
      list.push(session);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start.localeCompare(b.start));
    }
    return map;
  }, [days, sessions]);

  const googleByDay = useMemo(() => {
    const map = new Map<string, CalendarFeedItem[]>();
    for (const day of days) map.set(toIsoDate(day), []);
    for (const item of googleItems) {
      const key = item.allDay
        ? item.startsAt.slice(0, 10)
        : toIsoDate(new Date(item.startsAt));
      const list = map.get(key);
      if (list) list.push(item);
    }
    return map;
  }, [days, googleItems]);

  if (isLoading) {
    return <p className="p-6 text-sm text-muted">Cargando clases…</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
        <div
          className="min-w-[920px]"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${days.length}, minmax(180px, 1fr))`,
          }}
        >
          {days.map((day) => {
            const key = toIsoDate(day);
            const isToday = key === todayKey;
            const daySessions = byDay.get(key) ?? [];
            const extra = googleByDay.get(key) ?? [];
            return (
              <section
                key={key}
                className={`border-l border-line first:border-l-0 min-h-[28rem] ${
                  isToday ? 'bg-accent-soft/40' : ''
                }`}
              >
                {onOpenDay ? (
                  <button
                    type="button"
                    className="w-full px-3 py-3 text-left border-b border-line hover:bg-panel-2"
                    onClick={() => onOpenDay(day)}
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
                  </button>
                ) : (
                  <div className="px-3 py-3 border-b border-line">
                    <p className="text-[11px] uppercase tracking-wide text-muted">
                      {day.toLocaleDateString('es-AR', { weekday: 'long' })}
                    </p>
                    <p className="mt-0.5 text-sm font-medium">{day.getDate()}</p>
                  </div>
                )}
                <div className="p-2 space-y-2">
                  {daySessions.map((session) => (
                    <article
                      key={session.id}
                      className="rounded-xl border border-line bg-panel overflow-hidden"
                    >
                      <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-line/80">
                        <p className="font-semibold tabular-nums tracking-tight">
                          {session.start}
                        </p>
                        <button
                          type="button"
                          className={`text-xs tabular-nums hover:underline ${
                            session.remaining <= 0 ? 'text-rose' : 'text-muted'
                          }`}
                          onClick={() => setEditingCapacity(session)}
                          title="Editar cupo"
                        >
                          {session.booked}/{session.capacity}
                        </button>
                      </div>
                      <p className="px-3 pt-2 text-[11px] uppercase tracking-wide text-muted">
                        {session.service?.name ?? 'Clase'}
                      </p>
                      <ul className="px-2 py-1.5 space-y-0.5">
                        {session.attendees.map((attendee) => (
                          <li key={attendee.id}>
                            <button
                              type="button"
                              className="w-full text-left rounded-lg px-2 py-1.5 text-sm hover:bg-panel-2 min-h-10"
                              onClick={() =>
                                onSelect(attendeeToItem(session, attendee))
                              }
                            >
                              {attendee.contactName ||
                                attendee.contactPhone ||
                                'Alumna'}
                            </button>
                          </li>
                        ))}
                        {!session.attendees.length ? (
                          <li className="px-2 py-2 text-xs text-muted">
                            Nadie anotada
                          </li>
                        ) : null}
                      </ul>
                      {session.remaining > 0 && session.service ? (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-xs font-medium text-accent border-t border-line hover:bg-panel"
                          onClick={() => setAdding(session)}
                        >
                          Agregar alumna
                        </button>
                      ) : null}
                    </article>
                  ))}
                  {extra.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full text-left rounded-xl border border-accent/20 bg-accent-soft px-3 py-2 text-xs text-accent"
                      onClick={() => onSelect(item)}
                    >
                      {item.title}
                    </button>
                  ))}
                  {!daySessions.length && !extra.length ? (
                    <p className="px-2 py-6 text-sm text-muted text-center">
                      Sin clases
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {adding ? (
        <AddStudentDialog session={adding} onClose={() => setAdding(null)} />
      ) : null}
      {editingCapacity ? (
        <EditCapacityDialog
          session={editingCapacity}
          onClose={() => setEditingCapacity(null)}
        />
      ) : null}
    </>
  );
}

function EditCapacityDialog({
  session,
  onClose,
}: {
  session: ClassSession;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [capacity, setCapacity] = useState(String(session.capacity));
  const nextCapacity = Number(capacity);
  const tooSmall =
    Number.isFinite(nextCapacity) && nextCapacity < session.booked;

  const save = useMutation({
    mutationFn: async () => {
      const value = Number(capacity);
      if (!Number.isInteger(value) || value < 1 || value > 80) {
        throw new Error('El cupo tiene que ser un número entre 1 y 80.');
      }
      if (session.templateId) {
        return api(`/admin/class-templates/${session.templateId}`, {
          method: 'PATCH',
          body: JSON.stringify({ capacity: value }),
        });
      }
      if (!session.service?.id) {
        throw new Error('Esta clase no tiene un servicio para guardar el cupo.');
      }
      return api('/admin/class-templates', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: session.service.id,
          dayOfWeek: session.dayOfWeek,
          startTime: session.start,
          capacity: value,
        }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appointment-classes'] });
      await queryClient.invalidateQueries({ queryKey: ['class-templates'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-capacity-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <form
        className="relative w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl p-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending) return;
          save.mutate();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">
              Cupo de la clase
            </p>
            <h3 id="edit-capacity-title" className="font-semibold text-lg mt-1">
              {session.start} · {session.service?.name ?? 'Clase'}
            </h3>
            <p className="text-sm text-muted">
              {session.booked} {session.booked === 1 ? 'alumna anotada' : 'alumnas anotadas'}
            </p>
          </div>
          <button type="button" className="text-muted text-xl px-1" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted">Cantidad de lugares</span>
          <input
            className="input w-full"
            inputMode="numeric"
            autoFocus
            min={1}
            max={80}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </label>
        {tooSmall ? (
          <p className="text-sm text-rose">
            Ya hay {session.booked} anotadas. El cupo nuevo no las saca, pero
            no van a entrar más.
          </p>
        ) : (
          <p className="text-xs text-muted">
            Este cupo vale para este horario todas las semanas.
          </p>
        )}
        {save.isError ? (
          <p className="text-sm text-rose">{formatApiError(save.error)}</p>
        ) : null}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            className="btn-primary min-h-11 px-4"
            disabled={save.isPending || !capacity.trim()}
          >
            {save.isPending ? 'Guardando…' : 'Guardar cupo'}
          </button>
          <button type="button" className="text-sm text-muted" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function AddStudentDialog({
  session,
  onClose,
}: {
  session: ClassSession;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const clientsQuery = useQuery({
    queryKey: ['clients', 'picker', query],
    queryFn: () =>
      api<ClientRow[]>(
        `/admin/clients${query ? `?name=${encodeURIComponent(query)}` : ''}`,
      ),
  });

  const add = useMutation({
    mutationFn: (userId: string) =>
      api('/admin/appointments', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: session.service?.id,
          userId,
          startsAt: session.startsAt,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appointment-classes'] });
      await queryClient.invalidateQueries({ queryKey: ['appointments-calendar'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">
              Anotar en clase
            </p>
            <h3 className="font-semibold text-lg mt-1">
              {session.start} · {session.service?.name}
            </h3>
            <p className="text-sm text-muted">
              {session.booked}/{session.capacity} lugares tomados
            </p>
          </div>
          <button type="button" className="text-muted text-xl px-1" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="input w-full"
          placeholder="Buscar clienta"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {add.isError ? (
          <p className="text-sm text-rose">{formatApiError(add.error)}</p>
        ) : null}
        <ul className="divide-y divide-line max-h-80 overflow-y-auto">
          {(clientsQuery.data ?? []).slice(0, 40).map((client) => (
            <li key={client.id}>
              <button
                type="button"
                className="w-full text-left py-3 min-h-11 hover:bg-panel-2 px-1"
                disabled={add.isPending}
                onClick={() => add.mutate(client.id)}
              >
                <p className="text-sm font-medium">{clientLabel(client)}</p>
                <p className="text-xs text-muted">
                  {client.phone || client.email || 'Sin contacto'}
                </p>
              </button>
            </li>
          ))}
          {!clientsQuery.data?.length ? (
            <li className="py-6 text-sm text-muted">No hay clientas para mostrar.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
