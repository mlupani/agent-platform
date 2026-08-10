'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import { useRealtimeInvalidation } from '@/hooks/use-realtime';

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
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="p-3 flex flex-col gap-1">
      {NAV.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  useRealtimeInvalidation();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: business } = useQuery({
    queryKey: ['current-business'],
    queryFn: () => api<Business>('/admin/business'),
    staleTime: 60_000,
  });

  const email = adminEmail();
  const initial = email.slice(0, 1).toUpperCase();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
        <NavLinks pathname={pathname} />
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
            <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />
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
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white text-xs font-semibold">
              {initial}
            </span>
            <span className="hidden sm:inline truncate max-w-[12rem]">{email}</span>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-x-clip">
          {children}
        </main>
      </div>
    </div>
  );
}
