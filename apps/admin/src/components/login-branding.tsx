'use client';

import { useEffect, useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:3001/api';

interface Branding {
  name: string | null;
  logoUrl: string | null;
}

export function LoginBranding() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/auth/branding`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          if (data && typeof data.name !== 'undefined') setBranding(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Loading skeleton — subtle, no layout shift
  if (!loaded) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-[72px] w-[72px] rounded-2xl bg-panel-2 border border-line animate-pulse" />
        <div className="h-3 w-20 rounded bg-panel-2 animate-pulse" />
      </div>
    );
  }

  const name = branding?.name?.trim() || null;
  const logoUrl = branding?.logoUrl?.trim() || null;
  const initial = name ? name.slice(0, 1).toUpperCase() : 'N';

  return (
    <div className="flex flex-col items-center text-center gap-3">
      <div className="h-[72px] w-[72px] sm:h-20 sm:w-20 rounded-2xl bg-white border border-line shadow-sm flex items-center justify-center overflow-hidden">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={name ? `Logo de ${name}` : 'Logo del negocio'}
            className="h-full w-full object-contain p-2.5"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-accent to-accent/70 text-white text-xl font-semibold tracking-tight">
            {initial}
          </div>
        )}
      </div>
      {name ? (
        <p className="text-sm font-semibold tracking-tight text-text leading-none">
          {name}
        </p>
      ) : null}
    </div>
  );
}
