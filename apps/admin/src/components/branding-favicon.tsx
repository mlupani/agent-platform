'use client';

import { useEffect } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:3001/api';

function setFavicon(href: string) {
  if (typeof document === 'undefined') return;
  // favicon estándar
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = href;

  // apple touch para iOS
  let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!apple) {
    apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    document.head.appendChild(apple);
  }
  apple.href = href;

  // shortcut icon fallback
  let shortcut = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
  if (!shortcut) {
    shortcut = document.createElement('link');
    shortcut.rel = 'shortcut icon';
    document.head.appendChild(shortcut);
  }
  shortcut.href = href;
}

function optimizeCloudinaryForFavicon(url: string): string {
  // Intenta pedir 64x64 optimizado si es Cloudinary; si no, devuelve original.
  // Cloudinary URL típico: https://res.cloudinary.com/<cloud>/image/upload/<...> /<publicId>
  // Insertamos c_fill,w_64,h_64,f_auto,q_auto
  try {
    const u = new URL(url);
    if (!u.hostname.includes('cloudinary.com')) return url;
    // insertar transformación después de /upload/
    const marker = '/upload/';
    const idx = url.indexOf(marker);
    if (idx === -1) return url;
    // evitar doble transformación si ya contiene f_auto
    if (url.includes('f_auto') && url.includes('w_64')) return url;
    return url.slice(0, idx + marker.length) + 'c_fill,w_64,h_64,f_auto,q_auto/' + url.slice(idx + marker.length);
  } catch {
    return url;
  }
}

export function BrandingFavicon() {
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/auth/branding`, { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { logoUrl?: string | null } | null) => {
        if (cancelled) return;
        const raw = data?.logoUrl?.trim();
        if (!raw) return;
        const href = optimizeCloudinaryForFavicon(raw);
        setFavicon(href);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
