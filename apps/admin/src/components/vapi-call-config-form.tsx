'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

interface VapiCallPublicConfig {
  businessId: string;
  hasApiKey: boolean;
  phoneNumberId: string | null;
  phoneNumberE164: string | null;
  voiceProvider: string;
  voiceId: string;
  transcriberLanguage: string | null;
  firstMessage: string | null;
  enabled: boolean;
  agentEnabled: boolean;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  webhookUrl: string;
}

interface VapiPhoneNumber {
  id: string;
  number: string | null;
  name: string | null;
  provider: string;
}

const VOICES = ['Elliot', 'Rohan', 'Lily', 'Savannah', 'Hana', 'Cole', 'Paige', 'Spencer'];

export function VapiCallConfigForm() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['vapi-call-config'],
    queryFn: () => api<VapiCallPublicConfig | null>('/admin/calls'),
  });

  const [apiKey, setApiKey] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [voiceId, setVoiceId] = useState('Elliot');
  const [language, setLanguage] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  if (data && !hydrated) {
    setHydrated(true);
    setPhoneNumberId(data.phoneNumberId ?? '');
    setVoiceId(data.voiceId || 'Elliot');
    setLanguage(data.transcriberLanguage ?? '');
    setFirstMessage(data.firstMessage ?? '');
    setEnabled(data.enabled);
    setAgentEnabled(data.agentEnabled);
  }

  const phoneNumbers = useQuery({
    queryKey: ['vapi-phone-numbers'],
    queryFn: () => api<VapiPhoneNumber[]>('/admin/calls/phone-numbers'),
    enabled: Boolean(data?.hasApiKey || apiKey),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      api<VapiCallPublicConfig>('/admin/calls', {
        method: 'PUT',
        body: JSON.stringify({
          ...(apiKey ? { vapiApiKey: apiKey } : {}),
          phoneNumberId: phoneNumberId || null,
          voiceId,
          transcriberLanguage: language || null,
          firstMessage: firstMessage || null,
          enabled,
          agentEnabled,
        }),
      }),
    onSuccess: async () => {
      setApiKey('');
      await qc.invalidateQueries({ queryKey: ['vapi-call-config'] });
      await qc.invalidateQueries({ queryKey: ['vapi-phone-numbers'] });
    },
  });

  const sync = useMutation({
    mutationFn: () => api('/admin/calls/sync', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vapi-call-config'] }),
  });

  if (isLoading) return <p className="text-sm text-muted">Cargando…</p>;

  const statusLabel =
    data?.status === 'connected' ? 'Conectado' : data?.status === 'error' ? 'Error' : 'Desconectado';

  return (
    <section className="panel rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Llamadas (Vapi)</h3>
          <p className="text-sm text-muted mt-1">
            El asistente atiende llamadas telefónicas entrantes. El número tiene que
            existir en tu cuenta de Vapi. El negocio es responsable de los avisos legales
            de grabación o transcripción de llamadas.
          </p>
        </div>
        <span
          className={`mono text-xs px-2 py-1 rounded border ${
            data?.status === 'connected'
              ? 'border-teal/40 text-teal'
              : data?.status === 'error'
                ? 'border-rose/40 text-rose'
                : 'border-line text-muted'
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {data?.lastError ? <p className="text-sm text-rose">{data.lastError}</p> : null}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">API key de Vapi{data?.hasApiKey ? ' · ya hay una guardada' : ''}</span>
          <input
            type="password"
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            placeholder={data?.hasApiKey ? 'Dejar vacío para mantener la actual' : 'vapi_...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Número</span>
          <select
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          >
            <option value="">— Elegí un número —</option>
            {(phoneNumbers.data ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.number ?? n.id} {n.name ? `(${n.name})` : ''}
              </option>
            ))}
          </select>
          {phoneNumbers.error ? (
            <span className="text-xs text-rose">No pude listar números: revisá la API key.</span>
          ) : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Voz</span>
          <select
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Idioma</span>
          <select
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">Automático</option>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </select>
        </label>

        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Primer mensaje (opcional)</span>
          <input
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            placeholder="Si lo dejás vacío usa el mensaje de bienvenida del negocio"
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Habilitado
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={agentEnabled}
            onChange={(e) => setAgentEnabled(e.target.checked)}
          />
          Agente activo
        </label>

        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-amber px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-60 min-h-10"
            disabled={save.isPending}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-4 py-2.5 text-sm disabled:opacity-60 min-h-10"
            disabled={sync.isPending || !data?.phoneNumberId}
            onClick={() => sync.mutate()}
          >
            Resincronizar número
          </button>
          {save.error ? (
            <span className="text-sm text-rose">{(save.error as Error).message}</span>
          ) : null}
          {save.isSuccess ? <span className="text-sm text-teal">Guardado</span> : null}
        </div>
      </form>

      <div className="text-xs text-muted space-y-1 break-all">
        <p>
          URL de webhook (se apunta sola al guardar el número):{' '}
          <span className="text-text">{data?.webhookUrl}</span>
        </p>
        {data?.phoneNumberE164 ? <p>Número conectado: {data.phoneNumberE164}</p> : null}
        {data?.lastSyncedAt ? (
          <p>Última sincronización: {new Date(data.lastSyncedAt).toLocaleString()}</p>
        ) : null}
      </div>
    </section>
  );
}
