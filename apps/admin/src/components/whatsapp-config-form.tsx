'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { WhatsAppIcon } from '@/components/channel-icons';
import { ChannelAgentRadios } from '@/components/channel-agent-radios';
import { api } from '@/lib/api';

interface WhatsAppPublicConfig {
  id: string;
  businessId: string;
  provider: string;
  wahaBaseUrl: string | null;
  sessionName: string;
  hasWahaApiKey: boolean;
  displayPhoneNumber: string | null;
  meId: string | null;
  enabled: boolean;
  agentEnabled: boolean;
  status: string;
  sessionStatus: string | null;
  lastError: string | null;
  webhookUrl: string;
  qrDataUrl?: string | null;
}

interface SessionStatus {
  status: string;
  qrDataUrl?: string | null;
  sessionStatus?: string | null;
  displayPhoneNumber?: string | null;
  meId?: string | null;
  lastError?: string | null;
}

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  scan_qr: 'Escaneá el QR',
  disconnected: 'Desconectado',
  error: 'Error',
};

export function WhatsAppConfigForm() {
  const queryClient = useQueryClient();
  const autoStarted = useRef(false);
  const [qr, setQr] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () => api<WhatsAppPublicConfig | null>('/admin/whatsapp'),
    // Solo estado, sin martillar el endpoint de QR (rompe Chromium/WEBJS)
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'connecting') return 4_000;
      if (status === 'scan_qr') return 5_000;
      return false;
    },
  });

  useEffect(() => {
    if (data?.qrDataUrl) setQr(data.qrDataUrl);
    if (data?.status === 'connected') setQr(null);
  }, [data?.qrDataUrl, data?.status]);

  const start = useMutation({
    mutationFn: async () =>
      api<SessionStatus>('/admin/whatsapp/session/start', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: async (result) => {
      if (result.qrDataUrl) setQr(result.qrDataUrl);
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
    },
  });

  const stop = useMutation({
    mutationFn: async (logout: boolean) =>
      api('/admin/whatsapp/session/stop', {
        method: 'POST',
        body: JSON.stringify({ logout }),
      }),
    onSuccess: async () => {
      setQr(null);
      autoStarted.current = false;
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
    },
  });

  const setAgent = useMutation({
    mutationFn: async (agentEnabled: boolean) =>
      api<WhatsAppPublicConfig>('/admin/whatsapp', {
        method: 'PUT',
        body: JSON.stringify({ agentEnabled }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
    },
  });

  const refreshQr = useMutation({
    mutationFn: async () => {
      if (
        !data ||
        data.status === 'disconnected' ||
        data.status === 'error'
      ) {
        return start.mutateAsync();
      }
      return api<{ qrDataUrl: string | null }>('/admin/whatsapp/session/qr');
    },
    onSuccess: async (result) => {
      if (result.qrDataUrl) setQr(result.qrDataUrl);
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
    },
  });

  // Al abrir: iniciar una vez y pedir QR una sola vez
  useEffect(() => {
    if (isLoading || !data || autoStarted.current) return;
    autoStarted.current = true;

    if (data.status === 'connected') return;

    if (data.status === 'scan_qr' && data.qrDataUrl) {
      setQr(data.qrDataUrl);
      return;
    }

    if (data.status === 'scan_qr') {
      refreshQr.mutate();
      return;
    }

    if (data.status === 'error') {
      // Sesión FAILED tras scan: reiniciar limpio
      start.mutate();
      return;
    }

    start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data?.id, data?.status]);

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando WhatsApp…</p>;
  }

  const status = data?.status ?? 'disconnected';
  const connected = status === 'connected';
  const showQr = !connected && Boolean(qr || data?.qrDataUrl);
  const busy = start.isPending || refreshQr.isPending || stop.isPending;

  return (
    <section className="panel rounded-2xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-[#25D366]/15 grid place-items-center text-[#25D366] shrink-0">
            <WhatsAppIcon className="h-5 w-5" title="WhatsApp" />
          </div>
          <div>
            <h3 className="font-medium">WhatsApp</h3>
            <p className="text-sm text-muted mt-1">
              Escaneá el QR una sola vez y esperá sin refrescar muchas veces.
              Mientras vinculás, evitá abrir WhatsApp Web en otra pestaña.
            </p>
          </div>
        </div>
        <span
          className={`text-xs px-2.5 py-1 rounded-full ${
            connected
              ? 'badge-success'
              : status === 'error'
                ? 'bg-rose/10 text-rose'
                : status === 'scan_qr' || status === 'connecting'
                  ? 'badge-warn'
                  : 'badge-muted'
          }`}
        >
          {statusLabel[status] ?? status}
        </span>
      </div>

      {(data?.displayPhoneNumber || data?.meId) && (
        <p className="text-sm text-muted">
          Número:{' '}
          <span className="text-text font-medium">
            {data.displayPhoneNumber || data.meId}
          </span>
        </p>
      )}

      {data?.lastError || start.error || stop.error || refreshQr.error ? (
        <p className="text-sm text-rose">
          {data?.lastError ||
            (
              (start.error || stop.error || refreshQr.error) as Error
            )?.message}
        </p>
      ) : null}

      {connected ? (
        <div className="rounded-2xl border border-line bg-panel-2 p-5">
          <p className="text-sm font-medium text-success">Sesión activa</p>
          <p className="text-sm text-muted mt-1">
            WhatsApp está conectado. Los mensajes entran al inbox
            automáticamente.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-panel-2 p-5 flex flex-col items-center gap-3">
          {showQr ? (
            <>
              <p className="text-sm text-muted">Escaneá con WhatsApp</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr || data?.qrDataUrl || ''}
                alt="QR WhatsApp"
                className="w-full max-w-56 aspect-square rounded-xl bg-white p-2 object-contain"
              />
              <p className="text-xs text-muted text-center max-w-sm">
                Después de escanear, esperá unos segundos. El estado pasa a
                Conectado solo.
              </p>
            </>
          ) : (
            <div className="w-full max-w-56 aspect-square rounded-xl border border-dashed border-line grid place-items-center text-sm text-muted text-center px-4">
              {busy ? 'Generando QR…' : 'Sin QR todavía. Tocá Refrescar QR.'}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <button
            type="button"
            className="rounded-lg border border-line bg-panel px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
            disabled={busy}
            onClick={() => refreshQr.mutate()}
          >
            {refreshQr.isPending || start.isPending
              ? 'Actualizando…'
              : 'Refrescar QR'}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-line bg-panel px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
            disabled={busy}
            onClick={() => {
              autoStarted.current = false;
              start.mutate();
            }}
          >
            Reconectar
          </button>
        )}
        {status === 'error' ? (
          <button
            type="button"
            className="rounded-lg bg-accent text-white px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
            disabled={busy}
            onClick={() => start.mutate()}
          >
            Reiniciar sesión
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-lg border border-rose/30 text-rose bg-panel px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
          disabled={busy || status === 'disconnected'}
          onClick={() => stop.mutate(false)}
        >
          Desconectar
        </button>
        <button
          type="button"
          className="rounded-lg border border-rose/30 text-rose bg-panel px-4 py-2.5 text-sm min-h-10 disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            if (confirm('¿Cerrar sesión de WhatsApp en este dispositivo?')) {
              stop.mutate(true);
            }
          }}
        >
          Logout
        </button>
      </div>

      <ChannelAgentRadios
        name="whatsapp-agent"
        value={data?.agentEnabled !== false}
        disabled={!data || setAgent.isPending}
        onChange={(next) => setAgent.mutate(next)}
        hint="WhatsApp puede quedar conectado al inbox sin que el agente conteste."
      />
      {setAgent.error ? (
        <p className="text-sm text-rose">
          {setAgent.error instanceof Error
            ? setAgent.error.message
            : 'No se pudo guardar el agente'}
        </p>
      ) : null}
    </section>
  );
}
