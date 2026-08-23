'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { LeadLifecycleConfig } from '@/lib/types';

const DELAY_PRESETS = ['24, 72, 168', '24, 48, 96', '12, 36, 72'];

export function LeadLifecycleForm() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['lead-lifecycle'],
    queryFn: () => api<LeadLifecycleConfig>('/admin/leads/lifecycle'),
  });

  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [conversionMode, setConversionMode] =
    useState<LeadLifecycleConfig['conversionMode']>('manual');
  const [paymentTrigger, setPaymentTrigger] = useState(false);
  const [appointmentTrigger, setAppointmentTrigger] = useState(false);
  const [delays, setDelays] = useState('24, 72, 168');
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [generateWithAi, setGenerateWithAi] = useState(true);
  const [sendMode, setSendMode] =
    useState<LeadLifecycleConfig['sendMode']>('reminder_only');
  const [quietHoursStart, setQuietHoursStart] = useState('09:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('21:00');
  const [askForMissingContact, setAskForMissingContact] = useState(true);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  if (data && hydratedKey === null) {
    setHydratedKey('loaded');
    setFollowUpEnabled(data.followUpEnabled);
    setConversionMode(data.conversionMode);
    setPaymentTrigger(data.conversionTriggers.includes('payment.created'));
    setAppointmentTrigger(
      data.conversionTriggers.includes('appointment.confirmed'),
    );
    setDelays(data.followUpDelaysHours.join(', '));
    setMaxAttempts(data.maxAttempts);
    setGenerateWithAi(data.generateWithAi);
    setSendMode(data.sendMode);
    setQuietHoursStart(data.quietHoursStart);
    setQuietHoursEnd(data.quietHoursEnd);
    setAskForMissingContact(data.askForMissingContact);
  }

  const save = useMutation({
    mutationFn: () =>
      api<LeadLifecycleConfig>('/admin/leads/lifecycle', {
        method: 'PUT',
        body: JSON.stringify({
          followUpEnabled,
          conversionMode,
          conversionTriggers: [
            ...(paymentTrigger ? ['payment.created'] : []),
            ...(appointmentTrigger ? ['appointment.confirmed'] : []),
          ],
          followUpDelaysHours: delays
            .split(',')
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isFinite(item) && item >= 1),
          maxAttempts,
          generateWithAi,
          sendMode,
          quietHoursStart,
          quietHoursEnd,
          askForMissingContact,
        }),
      }),
    onSuccess: async (result) => {
      setFollowUpEnabled(result.followUpEnabled);
      setConversionMode(result.conversionMode);
      setPaymentTrigger(result.conversionTriggers.includes('payment.created'));
      setAppointmentTrigger(
        result.conversionTriggers.includes('appointment.confirmed'),
      );
      setDelays(result.followUpDelaysHours.join(', '));
      setMaxAttempts(result.maxAttempts);
      setGenerateWithAi(result.generateWithAi);
      setSendMode(result.sendMode);
      setQuietHoursStart(result.quietHoursStart);
      setQuietHoursEnd(result.quietHoursEnd);
      setAskForMissingContact(result.askForMissingContact);
      await queryClient.invalidateQueries({ queryKey: ['lead-lifecycle'] });
    },
  });

  if (isLoading) {
    return (
      <section className="panel rounded-2xl p-5">
        <p className="text-sm text-muted">Cargando seguimiento de leads…</p>
      </section>
    );
  }

  return (
    <section className="panel rounded-2xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Seguimiento de leads</h3>
          <p className="text-sm text-muted mt-1 max-w-xl">
            El follow-up automático arranca apagado. Cuando lo actives, solo
            toca leads interesados y contactables.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm min-h-10 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={followUpEnabled}
            onChange={(event) => setFollowUpEnabled(event.target.checked)}
          />
          Activar follow-up
        </label>
      </div>

      {error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm text-muted">Retrasos en horas</p>
        <div className="flex flex-wrap gap-2">
          {DELAY_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={!followUpEnabled}
              onClick={() => setDelays(preset)}
              className={`rounded-lg border px-3 py-2 text-sm min-h-10 ${
                delays === preset
                  ? 'border-accent bg-accent text-white'
                  : 'border-line text-muted'
              } disabled:opacity-50`}
            >
              {preset.replaceAll(',', ' /')} h
            </button>
          ))}
        </div>
        <label className="block text-sm max-w-xs">
          <span className="text-muted">Personalizado</span>
          <input
            className="mt-1 w-full input"
            disabled={!followUpEnabled}
            value={delays}
            onChange={(event) => setDelays(event.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Intentos máximos</span>
          <input
            type="number"
            min={1}
            max={8}
            disabled={!followUpEnabled}
            className="input w-full"
            value={maxAttempts}
            onChange={(event) =>
              setMaxAttempts(Math.min(8, Math.max(1, Number(event.target.value) || 1)))
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Modo de envío</span>
          <select
            className="input w-full"
            disabled={!followUpEnabled}
            value={sendMode}
            onChange={(event) =>
              setSendMode(event.target.value as LeadLifecycleConfig['sendMode'])
            }
          >
            <option value="reminder_only">Solo recordatorio en el dashboard</option>
            <option value="review">Generar borrador y revisar</option>
            <option value="auto">Enviar automático</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Horario silencioso desde</span>
          <input
            type="time"
            className="input w-full"
            disabled={!followUpEnabled}
            value={quietHoursStart}
            onChange={(event) => setQuietHoursStart(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Hasta</span>
          <input
            type="time"
            className="input w-full"
            disabled={!followUpEnabled}
            value={quietHoursEnd}
            onChange={(event) => setQuietHoursEnd(event.target.value)}
          />
        </label>
      </div>

      <label className="inline-flex items-center gap-2 text-sm min-h-10 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={generateWithAi}
          disabled={!followUpEnabled}
          onChange={(event) => setGenerateWithAi(event.target.checked)}
        />
        Generar el mensaje con IA
      </label>

      <label className="inline-flex items-center gap-2 text-sm min-h-10 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={askForMissingContact}
          onChange={(event) => setAskForMissingContact(event.target.checked)}
        />
        Pedir WhatsApp o email si el lead no es contactable
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium">Conversión</p>
        <label className="block space-y-1 text-sm max-w-sm">
          <span className="text-muted">Modo</span>
          <select
            className="input w-full"
            value={conversionMode}
            onChange={(event) =>
              setConversionMode(
                event.target.value as LeadLifecycleConfig['conversionMode'],
              )
            }
          >
            <option value="manual">Solo manual</option>
            <option value="suggested">Sugerir en el dashboard</option>
            <option value="automatic">Automática por señales</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm min-h-10 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={paymentTrigger}
            onChange={(event) => setPaymentTrigger(event.target.checked)}
          />
          Pago creado
        </label>
        <label className="flex items-center gap-2 text-sm min-h-10 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={appointmentTrigger}
            onChange={(event) => setAppointmentTrigger(event.target.checked)}
          />
          Turno confirmado
        </label>
      </div>

      {save.error ? (
        <p className="text-sm text-rose">{(save.error as Error).message}</p>
      ) : null}
      {save.isSuccess ? (
        <p className="text-sm text-success">Seguimiento de leads guardado.</p>
      ) : null}

      <button
        type="button"
        className="btn-primary min-h-11 px-4"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Guardando…' : 'Guardar seguimiento'}
      </button>
    </section>
  );
}
