'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { InstagramIconMono } from '@/components/channel-icons';
import { api } from '@/lib/api';

interface InstagramPublicConfig {
  id: string;
  businessId: string;
  enabled: boolean;
  status: string;
  username: string | null;
  userId: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  hasSession: boolean;
  apiUrlConfigured: boolean;
}

const statusLabel: Record<string, string> = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  disconnected: 'Desconectado',
  challenge: 'Requiere verificación',
  error: 'Error',
};

export function InstagramConfigForm() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['instagram-config'],
    queryFn: () => api<InstagramPublicConfig | null>('/admin/instagram'),
  });

  const login = useMutation({
    mutationFn: async () =>
      api<InstagramPublicConfig>('/admin/instagram/login', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim().replace(/^@/, ''),
          password,
          ...(verificationCode.trim()
            ? { verificationCode: verificationCode.trim() }
            : {}),
        }),
      }),
    onSuccess: async () => {
      setPassword('');
      setVerificationCode('');
      await queryClient.invalidateQueries({ queryKey: ['instagram-config'] });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () =>
      api('/admin/instagram/disconnect', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['instagram-config'] });
    },
  });

  const reconnect = useMutation({
    mutationFn: async () =>
      api('/admin/instagram/reconnect', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['instagram-config'] });
    },
  });

  const refreshStatus = useMutation({
    mutationFn: async () => api<InstagramPublicConfig>('/admin/instagram/status'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['instagram-config'] });
    },
  });

  const syncNow = useMutation({
    mutationFn: async () =>
      api<{ processed: number }>('/admin/instagram/sync', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['instagram-config'] });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Cargando Instagram…</p>;
  }

  const status = data?.status ?? 'disconnected';
  const connected = status === 'connected';

  return (
    <div className="space-y-6">
      <div className="panel rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] grid place-items-center text-white shrink-0">
              <InstagramIconMono className="h-5 w-5" title="Instagram" />
            </div>
            <div>
              <h3 className="font-medium">Instagram</h3>
            </div>
          </div>
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              connected ? 'badge-success' : status === 'error' ? 'badge-warn' : 'badge-muted'
            }`}
          >
            {statusLabel[status] ?? status}
          </span>
        </div>

        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Usuario</dt>
            <dd className="font-medium">
              {data?.username ? `@${data.username}` : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Última sincronización</dt>
            <dd>
              {data?.lastSyncAt
                ? new Date(data.lastSyncAt).toLocaleString('es-AR')
                : '—'}
            </dd>
          </div>
        </dl>

        {data?.lastError ? (
          <p className="text-sm text-rose break-words">{data.lastError}</p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="btn-secondary min-h-10"
            onClick={() => refreshStatus.mutate()}
            disabled={refreshStatus.isPending}
          >
            Verificar estado
          </button>
          {data?.hasSession ? (
            <>
              <button
                type="button"
                className="btn-secondary min-h-10"
                onClick={() => reconnect.mutate()}
                disabled={reconnect.isPending}
              >
                Reconectar
              </button>
              <button
                type="button"
                className="btn-secondary min-h-10"
                onClick={() => syncNow.mutate()}
                disabled={syncNow.isPending || !connected}
              >
                Sincronizar ahora
              </button>
              <button
                type="button"
                className="btn-secondary min-h-10 text-rose"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                Desconectar
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!connected ? (
        <form
          className="panel rounded-2xl p-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <h3 className="font-medium">Conectar cuenta</h3>
          <label className="block space-y-1.5">
            <span className="text-sm text-muted">Usuario de Instagram</span>
            <input
              className="input w-full"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="usuario"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-muted">Contraseña</span>
            <div className="flex gap-2">
              <input
                className="input w-full"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="btn-secondary min-h-10 shrink-0"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-muted">
              Código 2FA / challenge (si Instagram lo pide)
            </span>
            <input
              className="input w-full"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Opcional"
            />
          </label>
          {login.error ? (
            <p className="text-sm text-rose">
              {(login.error as Error).message}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn-primary min-h-10"
            disabled={login.isPending || !username.trim() || !password}
          >
            {login.isPending ? 'Conectando…' : 'Conectar'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
