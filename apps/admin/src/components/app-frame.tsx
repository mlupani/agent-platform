'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/shell';

interface AuthMe {
  user: {
    id: string;
    username: string;
    role: 'ADMIN' | 'USER';
    displayName?: string | null;
  };
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/login';

  const me = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api<AuthMe>('/auth/me'),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isLogin && me.isSuccess) {
      router.replace('/');
    }
  }, [isLogin, me.isSuccess, router]);

  useEffect(() => {
    if (!isLogin && me.isError) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLogin, me.isError, pathname, router]);

  useEffect(() => {
    if (isLogin || !me.data) return;
    if (
      (pathname.startsWith('/playground') || pathname.startsWith('/gastos')) &&
      me.data.user.role !== 'ADMIN'
    ) {
      router.replace('/');
    }
  }, [isLogin, me.data, pathname, router]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (me.isLoading || me.isError || !me.data) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-ink text-sm text-muted">
        {me.isError ? 'Redirigiendo al login…' : 'Cargando…'}
      </div>
    );
  }

  return <Shell user={me.data.user}>{children}</Shell>;
}
