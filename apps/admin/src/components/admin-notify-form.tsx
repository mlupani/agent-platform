'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { AdminNotifyConfig } from '@/lib/types';

const EVENT_META = [
  { id: 'appointment.created', label: 'Clase agendada', hint: 'Cuando el agente reserva una clase' },
  { id: 'appointment.cancelled', label: 'Clase cancelada', hint: 'Cuando se cancela una clase' },
  { id: 'appointment.rescheduled', label: 'Clase reprogramada', hint: 'Cuando se mueve una clase' },
  { id: 'lead.created', label: 'Nuevo lead', hint: 'Cuando se genera un lead' },
  { id: 'client.auto_created', label: 'Cliente automático', hint: 'Cuando un lead se convierte solo' },
] as const;

export function AdminNotifyForm() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-notify'],
    queryFn: () => api<AdminNotifyConfig>('/admin/notify'),
  });

  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [events, setEvents] = useState<string[]>([
    'appointment.created',
    'lead.created',
    'client.auto_created',
  ]);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  if (data && hydratedKey === null) {
    setHydratedKey('loaded');
    setEnabled(data.enabled);
    setEmail(data.email ?? '');
    setEvents(data.events);
  }

  const save = useMutation({
    mutationFn: () =>
      api<AdminNotifyConfig>('/admin/notify', {
        method: 'PUT',
        body: JSON.stringify({ enabled, email: email.trim() || null, events }),
      }),
    onSuccess: async (result) => {
      setEnabled(result.enabled);
      setEmail(result.email ?? '');
      setEvents(result.events);
      await queryClient.invalidateQueries({ queryKey: ['admin-notify'] });
    },
  });

  function toggleEvent(id: string) {
    setEvents((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  if (isLoading) {
    return (
      <section className="panel rounded-2xl p-5">
        <p className="text-sm text-muted">Cargando avisos…</p>
      </section>
    );
  }

  const eventsEmpty = events.length === 0;

  return (
    <section className="panel rounded-2xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Avisos por email</h3>
          <p className="text-sm text-muted mt-1 max-w-xl">
            Recibí un email cuando el agente agenda una clase, se genera un
            lead o se crea un cliente automático. Configurá el email destino y
            elegí qué eventos queres recibir.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm min-h-10 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Activar avisos
        </label>
      </div>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      {data && !data.emailConfigured ? (
        <p className="text-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          El email del sistema no está configurado. Definí{' '}
          <span className="mono text-xs">EMAIL_FROM</span> +{' '}
          <span className="mono text-xs">RESEND_API_KEY</span> (o{' '}
          <span className="mono text-xs">SMTP_*</span>) en el servidor para que
          los avisos puedan enviarse.
        </p>
      ) : null}

      <label className="block space-y-1 text-sm max-w-md">
        <span className="text-muted">Email destino</span>
        <input
          type="email"
          placeholder="vos@negocio.com"
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 disabled:opacity-50"
          disabled={!enabled}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <span className="block text-xs text-muted">
          Un solo email por negocio. Usá una casilla que revises seguido.
        </span>
      </label>

      <div className="space-y-2">
        <p className="text-sm text-muted">Eventos</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {EVENT_META.map((event) => {
            const on = events.includes(event.id);
            return (
              <button
                key={event.id}
                type="button"
                disabled={!enabled}
                onClick={() => toggleEvent(event.id)}
                className={`rounded-xl border p-3 text-left min-h-11 disabled:opacity-50 ${
                  on
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-panel-2'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{event.label}</span>
                  <span
                    className={`h-4 w-4 rounded border flex items-center justify-center text-[10px] ${
                      on
                        ? 'bg-white text-accent border-white'
                        : 'border-line bg-panel'
                    }`}
                    aria-hidden
                  >
                    {on ? '✓' : ''}
                  </span>
                </div>
                <p
                  className={`text-xs mt-1 ${on ? 'text-white/80' : 'text-muted'}`}
                >
                  {event.hint}
                </p>
                <p
                  className={`text-[11px] mono mt-1 ${on ? 'text-white/60' : 'text-muted/60'}`}
                >
                  {event.id}
                </p>
              </button>
            );
          })}
        </div>
        {eventsEmpty && enabled ? (
          <p className="text-xs text-amber-700">
            Elegí al menos un evento para recibir avisos.
          </p>
        ) : null}
      </div>

      {save.error ? (
        <p className="text-sm text-rose">{(save.error as Error).message}</p>
      ) : null}
      {save.isSuccess ? (
        <p className="text-sm text-success">Avisos guardados.</p>
      ) : null}

      <button
        type="button"
        className="rounded-lg bg-accent text-white px-4 py-2 text-sm min-h-10 hover:opacity-90 disabled:opacity-60"
        disabled={
          save.isPending ||
          (enabled && (!email.trim() || eventsEmpty))
        }
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Guardando…' : 'Guardar avisos'}
      </button>
    </section>
  );
}
