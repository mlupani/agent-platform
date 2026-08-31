'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';
import type { AdminNotifyConfig } from '@/lib/types';

const EVENT_META = [
  { id: 'appointment.created', label: 'Clase agendada', hint: 'Cuando el agente reserva una clase' },
  { id: 'appointment.cancelled', label: 'Clase cancelada', hint: 'Cuando se cancela una clase' },
  { id: 'appointment.rescheduled', label: 'Clase reprogramada', hint: 'Cuando se mueve una clase' },
  { id: 'lead.created', label: 'Nuevo lead', hint: 'Cuando se genera un lead' },
  { id: 'client.auto_created', label: 'Cliente automático', hint: 'Cuando un lead se convierte solo' },
] as const;

const MAX_EMAILS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailDraft(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function AdminNotifyForm() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-notify'],
    queryFn: () => api<AdminNotifyConfig>('/admin/notify'),
  });

  const [enabled, setEnabled] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([
    'appointment.created',
    'lead.created',
    'client.auto_created',
  ]);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  if (data && hydratedKey === null) {
    setHydratedKey('loaded');
    setEnabled(data.enabled);
    setEmails(data.emails ?? []);
    setEvents(data.events);
  }

  const save = useMutation({
    mutationFn: (nextEmails: string[]) =>
      api<AdminNotifyConfig>('/admin/notify', {
        method: 'PUT',
        body: JSON.stringify({ enabled, emails: nextEmails, events }),
      }),
    onSuccess: async (result) => {
      setEnabled(result.enabled);
      setEmails(result.emails ?? []);
      setEvents(result.events);
      setDraft('');
      setDraftError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-notify'] });
    },
  });

  function toggleEvent(id: string) {
    setEvents((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function mergeDraft(base: string[]): string[] | null {
    const parsed = parseEmailDraft(draft);
    if (!parsed.length) {
      setDraftError(null);
      return base;
    }
    const invalid = parsed.find((item) => !EMAIL_RE.test(item));
    if (invalid) {
      setDraftError(`Email inválido: ${invalid}`);
      return null;
    }
    const next = [...base];
    for (const email of parsed) {
      if (next.includes(email)) continue;
      if (next.length >= MAX_EMAILS) {
        setDraftError(`Máximo ${MAX_EMAILS} emails.`);
        return null;
      }
      next.push(email);
    }
    setDraft('');
    setDraftError(null);
    return next;
  }

  function addEmails() {
    const next = mergeDraft(emails);
    if (next) setEmails(next);
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((item) => item !== email));
  }

  function onDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addEmails();
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
            lead o se crea un cliente automático. Configurá uno o más emails
            destino y elegí qué eventos queres recibir.
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

      <div className="space-y-2 max-w-md">
        <span className="block text-sm text-muted">Emails destino</span>
        {emails.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {emails.map((email) => (
              <li
                key={email}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-panel-2 pl-2.5 pr-1 py-0.5 text-sm"
              >
                <span className="max-w-[220px] truncate">{email}</span>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => removeEmail(email)}
                  className="rounded-full w-6 h-6 inline-flex items-center justify-center text-muted hover:text-text disabled:opacity-50 cursor-pointer"
                  aria-label={`Quitar ${email}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Todavía no hay emails.</p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            placeholder="otro@negocio.com"
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 disabled:opacity-50"
            disabled={!enabled || emails.length >= MAX_EMAILS}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (draftError) setDraftError(null);
            }}
            onKeyDown={onDraftKeyDown}
          />
          <button
            type="button"
            disabled={!enabled || !draft.trim() || emails.length >= MAX_EMAILS}
            onClick={() => addEmails()}
            className="shrink-0 rounded-lg border border-line bg-panel px-3 py-2 text-sm min-h-10 disabled:opacity-50 cursor-pointer"
          >
            Agregar
          </button>
        </div>
        {draftError ? (
          <p className="text-xs text-amber-700">{draftError}</p>
        ) : (
          <span className="block text-xs text-muted">
            Podés agregar hasta {MAX_EMAILS}. Separá con coma para pegar varios.
          </span>
        )}
      </div>

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
          (enabled && (!emails.length || eventsEmpty))
        }
        onClick={() => {
          const next = mergeDraft(emails);
          if (!next) return;
          setEmails(next);
          save.mutate(next);
        }}
      >
        {save.isPending ? 'Guardando…' : 'Guardar avisos'}
      </button>
    </section>
  );
}
