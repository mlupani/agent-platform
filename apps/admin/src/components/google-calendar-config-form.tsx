'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface GoogleCalendarPublicConfig {
  id: string;
  businessId: string;
  calendarId: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  connectedEmail: string | null;
  hasRefreshToken: boolean;
  oauthConfigured: boolean;
}

export function GoogleCalendarConfigForm() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['google-calendar-config'],
    queryFn: () =>
      api<GoogleCalendarPublicConfig | null>('/admin/calendar'),
  });

  const [calendarId, setCalendarId] = useState('primary');
  const [refreshToken, setRefreshToken] = useState('');
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!data) return;
    setCalendarId(data.calendarId);
    setEnabled(data.enabled);
  }, [data]);

  const save = useMutation({
    mutationFn: async () =>
      api<GoogleCalendarPublicConfig>('/admin/calendar', {
        method: 'PUT',
        body: JSON.stringify({
          calendarId,
          enabled,
          ...(refreshToken ? { refreshToken } : {}),
        }),
      }),
    onSuccess: async () => {
      setRefreshToken('');
      await queryClient.invalidateQueries({
        queryKey: ['google-calendar-config'],
      });
    },
  });

  const connect = useMutation({
    mutationFn: async () => api<{ url: string }>('/admin/calendar/oauth-url'),
    onSuccess: (result) => {
      window.open(result.url, '_blank', 'noopener,noreferrer');
    },
  });

  const statusLabel =
    data?.status === 'connected'
      ? 'Conectado'
      : data?.status === 'error'
        ? 'Error'
        : 'Desconectado';

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando Google Calendar…</p>;
  }

  return (
    <section className="panel rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Google Calendar</h3>
          <p className="text-sm text-muted mt-1">
            Las citas se guardan localmente y se sincronizan si Calendar está
            conectado.
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

      {data?.connectedEmail ? (
        <p className="text-sm text-muted break-all">
          Cuenta: <span className="text-text">{data.connectedEmail}</span>
        </p>
      ) : null}
      {data?.lastError ? (
        <p className="text-sm text-rose">{data.lastError}</p>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="space-y-1 text-sm">
          <span className="text-muted">Calendar ID</span>
          <input
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder="primary"
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">
            Refresh token
            {data?.hasRefreshToken ? ' · ya hay uno guardado' : ''}
          </span>
          <input
            type="password"
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            placeholder={
              data?.hasRefreshToken
                ? 'Dejar vacío para mantener el actual'
                : 'Opcional si usás OAuth'
            }
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Habilitado
        </label>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-amber px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-60 min-h-10"
            disabled={save.isPending}
          >
            {save.isPending ? 'Guardando…' : 'Guardar Calendar'}
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-4 py-2.5 text-sm disabled:opacity-60 min-h-10"
            disabled={connect.isPending || data?.oauthConfigured === false}
            onClick={() => connect.mutate()}
            title={
              data?.oauthConfigured === false
                ? 'Configurá GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET'
                : undefined
            }
          >
            Conectar con Google
          </button>
          {save.isSuccess ? (
            <span className="text-sm text-teal">Guardado</span>
          ) : null}
          {save.error ? (
            <span className="text-sm text-rose">
              {(save.error as Error).message}
            </span>
          ) : null}
          {connect.error ? (
            <span className="text-sm text-rose">
              {(connect.error as Error).message}
            </span>
          ) : null}
        </div>
      </form>
      {!data?.oauthConfigured ? (
        <p className="text-xs text-muted">
          Para OAuth configurá GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
          GOOGLE_REDIRECT_URI. Sin Google, las citas siguen funcionando en modo
          local (horarios del negocio).
        </p>
      ) : null}
    </section>
  );
}
