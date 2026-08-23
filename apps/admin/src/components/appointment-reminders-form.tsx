'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

type ReminderChannel = 'whatsapp' | 'email' | 'instagram' | 'facebook';

interface ReminderConfig {
  enabled: boolean;
  hoursBefore: number;
  channels: ReminderChannel[];
  message: string;
  channelsStatus: {
    whatsapp: { connected: boolean };
    email: { configured: boolean };
    instagram: { connected: boolean };
    facebook: { connected: boolean };
  };
}

const HOUR_PRESETS = [1, 2, 4, 12, 24];

const CHANNEL_META: Array<{
  id: ReminderChannel;
  label: string;
  hint: string;
}> = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    hint: 'Usa el teléfono de la cita',
  },
  {
    id: 'email',
    label: 'Email',
    hint: 'Usa el email del alumno',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    hint: 'Solo si la cita nació de un Direct',
  },
  {
    id: 'facebook',
    label: 'Messenger',
    hint: 'Solo si la cita nació de Messenger',
  },
];

export function AppointmentRemindersForm() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['appointment-reminders'],
    queryFn: () => api<ReminderConfig>('/admin/appointment-reminders'),
  });

  const [enabled, setEnabled] = useState(false);
  const [hoursBefore, setHoursBefore] = useState(24);
  const [channels, setChannels] = useState<ReminderChannel[]>([
    'whatsapp',
    'email',
    'instagram',
    'facebook',
  ]);
  const [message, setMessage] = useState('');
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  if (data && hydratedKey === null) {
    setHydratedKey('loaded');
    setEnabled(data.enabled);
    setHoursBefore(data.hoursBefore);
    setChannels(data.channels);
    setMessage(data.message);
  }

  const save = useMutation({
    mutationFn: () =>
      api<ReminderConfig>('/admin/appointment-reminders', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          hoursBefore,
          channels,
          message,
        }),
      }),
    onSuccess: async (result) => {
      setEnabled(result.enabled);
      setHoursBefore(result.hoursBefore);
      setChannels(result.channels);
      setMessage(result.message);
      await queryClient.invalidateQueries({
        queryKey: ['appointment-reminders'],
      });
    },
  });

  function toggleChannel(id: ReminderChannel) {
    setChannels((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((item) => item !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  }

  if (isLoading) {
    return (
      <section className="panel rounded-2xl p-5">
        <p className="text-sm text-muted">Cargando recordatorios…</p>
      </section>
    );
  }

  return (
    <section className="panel rounded-2xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Recordatorios automáticos</h3>
          <p className="text-sm text-muted mt-1 max-w-xl">
            Avisamos al alumno antes del turno por el primer canal que tenga
            datos y esté conectado.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm min-h-10 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Activar
        </label>
      </div>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm text-muted">Cuántas horas antes</p>
        <div className="flex flex-wrap gap-2">
          {HOUR_PRESETS.map((hours) => {
            const on = hoursBefore === hours;
            return (
              <button
                key={hours}
                type="button"
                disabled={!enabled}
                onClick={() => setHoursBefore(hours)}
                className={`rounded-lg border px-3 py-2 text-sm min-h-10 ${
                  on
                    ? 'border-accent bg-accent text-white'
                    : 'border-line text-muted'
                } disabled:opacity-50`}
              >
                {hours === 1 ? '1 hora' : `${hours} horas`}
              </button>
            );
          })}
        </div>
        <label className="block text-sm max-w-48">
          <span className="text-muted">Personalizado (1-24)</span>
          <input
            type="number"
            min={1}
            max={24}
            disabled={!enabled}
            className="mt-1 w-full rounded-md bg-ink border border-line px-3 py-2 disabled:opacity-50"
            value={hoursBefore}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setHoursBefore(Math.min(24, Math.max(1, Math.round(n))));
            }}
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted">Canales, en orden de preferencia</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CHANNEL_META.map((channel) => {
            const index = channels.indexOf(channel.id);
            const on = index >= 0;
            const ready =
              channel.id === 'whatsapp'
                ? data?.channelsStatus.whatsapp.connected
                : channel.id === 'email'
                  ? data?.channelsStatus.email.configured
                  : channel.id === 'facebook'
                    ? data?.channelsStatus.facebook.connected
                    : data?.channelsStatus.instagram.connected;
            return (
              <button
                key={channel.id}
                type="button"
                disabled={!enabled}
                onClick={() => toggleChannel(channel.id)}
                className={`rounded-xl border p-3 text-left min-h-11 disabled:opacity-50 ${
                  on
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-panel-2'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{channel.label}</span>
                  {on ? (
                    <span className="text-[11px] opacity-80">#{index + 1}</span>
                  ) : null}
                </div>
                <p
                  className={`text-xs mt-1 ${on ? 'text-white/80' : 'text-muted'}`}
                >
                  {channel.hint}
                </p>
                <p
                  className={`text-[11px] mt-1.5 ${
                    ready
                      ? on
                        ? 'text-white/90'
                        : 'text-success'
                      : on
                        ? 'text-white/70'
                        : 'text-muted'
                  }`}
                >
                  {ready ? 'Listo para enviar' : 'Sin conexión todavía'}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-muted">Mensaje</span>
        <textarea
          rows={4}
          disabled={!enabled}
          className="w-full rounded-md bg-ink border border-line px-3 py-2 disabled:opacity-50"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="text-xs text-muted">
          Variables: {'{{nombre}}'}, {'{{servicio}}'}, {'{{fecha}}'}, {'{{hora}}'},{' '}
          {'{{negocio}}'}
        </span>
      </label>

      {save.error ? (
        <p className="text-sm text-rose">{(save.error as Error).message}</p>
      ) : null}
      {save.isSuccess ? (
        <p className="text-sm text-success">Recordatorios guardados.</p>
      ) : null}

      <button
        type="button"
        className="rounded-lg bg-accent text-white px-4 py-2 text-sm min-h-10 hover:opacity-90 disabled:opacity-60"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Guardando…' : 'Guardar recordatorios'}
      </button>
    </section>
  );
}
