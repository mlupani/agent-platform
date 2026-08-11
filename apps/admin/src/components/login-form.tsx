'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      const next = search.get('next') || '/';
      router.replace(next.startsWith('/') ? next : '/');
      router.refresh();
    } catch {
      setError('Usuario o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Usuario</span>
        <input
          className="input w-full"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Contraseña</span>
        <input
          type="password"
          className="input w-full"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn-primary w-full min-h-11"
        disabled={loading}
      >
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
