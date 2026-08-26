'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import { useRealtimeInvalidation } from '@/hooks/use-realtime';

interface ShellUser {
  id: string;
  username: string;
  role: 'ADMIN' | 'USER';
  displayName?: string | null;
}
const NAV = [
  {
    href: '/',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
      </svg>
    ),
  },
  {
    href: '/conversations',
    label: 'Conversaciones',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H10l-4 3v-3.2A2.5 2.5 0 0 1 5 13.5v-7Z" />
      </svg>
    ),
  },
  {
    href: '/leads',
    label: 'Leads',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="8" r="3" />
        <path d="M4 19c.6-3 2.6-5 5-5s4.4 2 5 5" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M16.2 19c.4-2.2 1.8-3.6 3.3-3.6.5 0 1 .1 1.5.4" />
      </svg>
    ),
  },
  {
    href: '/clientes',
    label: 'Alumnos',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 19c.8-3.2 3.3-5 6.5-5s5.7 1.8 6.5 5" />
      </svg>
    ),
  },
  {
    href: '/pagos',
    label: 'Pagos',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <path d="M3.5 10h17" />
        <path d="M8 15h3" />
      </svg>
    ),
  },
  {
    href: '/calendar',
    label: 'Calendario',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </svg>
    ),
  },
  {
    href: '/personalization',
    label: 'Personalización',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l1.2 3.6L17 8l-3.8 1.4L12 13l-1.2-3.6L7 8l3.8-1.4L12 3Z" />
        <path d="M18.5 13.5 19 15l1.5.5L19 16l-.5 1.5L18 16l-1.5-.5L18 15l.5-1.5Z" />
        <path d="M6 14.5 6.7 16.5 8.7 17.2 6.7 17.9 6 19.9 5.3 17.9 3.3 17.2 5.3 16.5 6 14.5Z" />
      </svg>
    ),
  },
  {
    href: '/knowledge',
    label: 'Conocimiento',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H12v16H6.5A1.5 1.5 0 0 1 5 18.5v-13Z" />
        <path d="M19 5.5A1.5 1.5 0 0 0 17.5 4H12v16h5.5A1.5 1.5 0 0 0 19 18.5v-13Z" />
      </svg>
    ),
  },
  {
    href: '/playground',
    label: 'Playground',
    adminOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 8h8v8H8z" />
        <path d="M10 12h4M12 10v4" />
        <path d="M5 7V5a1 1 0 0 1 1-1h2M19 7V5a1 1 0 0 0-1-1h-2M5 17v2a1 1 0 0 0 1 1h2M19 17v2a1 1 0 0 1-1 1h-2" />
      </svg>
    ),
  },
  {
    href: '/content',
    label: 'Contenido',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 14l2.5-3 2 2.5L15.5 10 16 14" />
        <circle cx="9" cy="8.5" r="1" />
      </svg>
    ),
  },
  {
    href: '/integrations',
    label: 'Integraciones',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 12h8" />
        <path d="M8 8a3 3 0 1 0 0 6" />
        <path d="M16 10a3 3 0 1 1 0 6" />
      </svg>
    ),
  },
  {
    href: '/gastos',
    label: 'Gastos',
    adminOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 10h8M8 14h5" />
        <path d="M16.5 13.5v.5a1.5 1.5 0 0 1-3 0V13" />
      </svg>
    ),
  },
];

function adminEmail() {
  return (
    process.env.NEXT_PUBLIC_ADMIN_EMAIL ??
    process.env.ADMIN_EMAIL ??
    'admin@negocio.local'
  );
}

function NavLinks({
  pathname,
  onNavigate,
  contentBadge = 0,
  role,
}: {
  pathname: string;
  onNavigate?: () => void;
  contentBadge?: number;
  role: 'ADMIN' | 'USER';
}) {
  const items = NAV.filter((item) => !item.adminOnly || role === 'ADMIN');
  return (
    <nav className="p-3 flex flex-col gap-1">
      {items.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
        const badge =
          item.href === '/content' && contentBadge > 0 ? contentBadge : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition min-h-11 ${
              active
                ? 'bg-nav-active text-white'
                : 'text-muted hover:bg-panel-2 hover:text-text'
            }`}
          >
            <span className={active ? 'text-white' : 'text-muted'}>
              {item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {badge > 0 ? (
              <span
                className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white tabular-nums"
                aria-label={`${badge} sin publicar`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({
  children,
  user,
}: {
  children: ReactNode;
  user: ShellUser;
}) {
  useRealtimeInvalidation();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }
  const { data: business } = useQuery({
    queryKey: ['current-business'],
    queryFn: () => api<Business>('/admin/business'),
    staleTime: 60_000,
  });
  const { data: contentSummary } = useQuery({
    queryKey: ['content-summary'],
    queryFn: () =>
      api<{ drafts: number }>('/admin/content/summary'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const contentBadge = contentSummary?.drafts ?? 0;

  const label =
    user.displayName?.trim() ||
    user.username ||
    adminEmail();
  const initial = label.slice(0, 1).toUpperCase();

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    await queryClient.clear();
    router.replace('/login');
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const brand = (
    <div className="px-5 py-5 border-b border-line">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
        Negocio
      </p>
      <h1 className="mt-1 text-lg font-semibold tracking-tight truncate">
        {business?.name ?? '…'}
      </h1>
    </div>
  );

  return (
    <div className="min-h-dvh grid lg:grid-cols-[240px_1fr] bg-ink">
      <aside className="hidden lg:flex lg:flex-col border-r border-line bg-panel">
        {brand}
        <NavLinks
          pathname={pathname}
          contentBadge={contentBadge}
          role={user.role}
        />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar menú"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative h-full w-[min(100%,20rem)] max-w-[85vw] bg-panel border-r border-line shadow-xl flex flex-col safe-pad-t">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="font-semibold truncate">{business?.name ?? 'Menú'}</p>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
                aria-label="Cerrar menú"
                onClick={() => setMenuOpen(false)}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <NavLinks
              pathname={pathname}
              contentBadge={contentBadge}
              role={user.role}
              onNavigate={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="min-h-dvh flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-line bg-panel px-3 sm:px-6 flex items-center justify-between gap-3 safe-pad-t">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel hover:bg-panel-2"
              aria-label="Abrir menú"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <p className="lg:hidden font-semibold truncate text-sm sm:text-base">
              {business?.name ?? 'Panel'}
            </p>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-muted shrink-0">
            <span className="hidden sm:inline text-[11px] uppercase tracking-wide text-muted">
              {user.role === 'ADMIN' ? 'Admin' : 'Usuario'}
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white text-xs font-semibold">
              {initial}
            </span>
            <span className="hidden sm:inline truncate max-w-[10rem]">
              {label}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-panel-2 hover:text-text"
            >
              Salir
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-x-hidden">
          <div className="w-full min-w-0 overflow-x-visible">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
